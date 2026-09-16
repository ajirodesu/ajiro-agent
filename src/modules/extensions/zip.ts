/**
 * Minimal, dependency-free ZIP package reader for Acode-compatible plugin
 * packages (plugin.zip). Reads the end-of-central-directory record and the
 * central directory (so sizes/offsets come from the authoritative record,
 * not local headers), and inflates STORE + DEFLATE entries.
 *
 * Security posture ([AJIRO ORIGINAL], prompt §12/§52):
 * - entries are validated against absolute paths, `..` traversal,
 *   backslash and drive/URL forms before anything is extracted
 * - CRC32 of every inflated entry is verified
 * - ZIP64 archives are rejected with a clear error (plugin packages are
 *   small; the format adds attack surface without benefit here)
 *
 * The inflate decoder is a compact canonical-Huffman implementation of
 * RFC 1951 (raw DEFLATE), written for Ajiro [AJIRO ORIGINAL].
 */

export class ZipError extends Error {}

export type ZipEntry = {
  compressedSize: number;
  crc32: number;
  /** External attributes; bit 4 of the high byte marks POSIX symlinks. */
  externalAttributes: number;
  method: number;
  name: string;
  size: number;
};

const U32 = (view: DataView, offset: number) => view.getUint32(offset, true);
const U16 = (view: DataView, offset: number) => view.getUint16(offset, true);

export function isZip(bytes: Uint8Array): boolean {
  // Local file header "PK\x03\x04" or empty/spanned-marker tolerant check.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      const commentLength = U16(new DataView(bytes.buffer, bytes.byteOffset), i + 20);
      if (i + 22 + commentLength <= bytes.length) return i;
    }
  }
  throw new ZipError("Not a valid ZIP archive (missing end record).");
}

function findCentralDirectory(bytes: Uint8Array): {
  entries: ZipEntry[];
  offsets: Map<string, number>;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const entryCount = U16(view, eocd + 10);
  const cdSize = U32(view, eocd + 12);
  const cdOffset = U32(view, eocd + 16);

  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    throw new ZipError("ZIP64 archives are not supported for plugin packages.");
  }
  if (cdOffset + cdSize > bytes.length) {
    throw new ZipError("Corrupted ZIP archive (central directory out of bounds).");
  }

  const entries: ZipEntry[] = [];
  const offsets = new Map<string, number>();
  let offset = cdOffset;
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || U32(view, offset) !== 0x0201_4b50) {
      throw new ZipError("Corrupted ZIP archive (bad central directory entry).");
    }
    const method = U16(view, offset + 10);
    const crc32 = U32(view, offset + 16);
    const compressedSize = U32(view, offset + 20);
    const size = U32(view, offset + 24);
    const nameLength = U16(view, offset + 28);
    const extraLength = U16(view, offset + 30);
    const commentLength = U16(view, offset + 32);
    const externalAttributes = U32(view, offset + 38);
    const localOffset = U32(view, offset + 42);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError("ZIP64 archives are not supported for plugin packages.");
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ compressedSize, crc32, externalAttributes, method, name, size });
    offsets.set(name, localOffset);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, offsets };
}

/** Entry names must be safe package-relative paths; directories end in "/". */
export function validateEntryName(name: string): string {
  if (name.includes("\\")) {
    throw new ZipError(`Unsafe archive entry: "${name}" (backslash path).`);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)) {
    throw new ZipError(`Unsafe archive entry: "${name}" (absolute/URL path).`);
  }
  if (name.startsWith("/")) {
    throw new ZipError(`Unsafe archive entry: "${name}" (absolute path).`);
  }
  const segments = name.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new ZipError(`Unsafe archive entry: "${name}" (path traversal).`);
    }
    if (segment.includes("\0")) {
      throw new ZipError(`Unsafe archive entry: "${name}" (invalid character).`);
    }
  }
  return segments.filter((segment) => segment && segment !== ".").join("/");
}

/** CRC-32 (IEEE 802.3), bit-reflected, as used by ZIP. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * RFC 1951 raw-DEFLATE decoder, puff-style (canonical Huffman with
 * count/first/index walk). Compact and well understood; correct decoding
 * is exercised against node's zlib in the unit tests.
 */
class BitReader {
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly bytes: Uint8Array) {}

  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  readBit(): number {
    if (this.bitCount === 0) {
      if (this.position >= this.bytes.length) {
        throw new ZipError("Unexpected end of DEFLATE stream.");
      }
      this.bitBuffer = this.bytes[this.position];
      this.position += 1;
      this.bitCount = 8;
    }
    const bit = this.bitBuffer & 1;
    this.bitBuffer >>>= 1;
    this.bitCount -= 1;
    return bit;
  }

  readBits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value |= this.readBit() << i;
    }
    return value;
  }

  /** Byte offset of the next unread byte (after discarding bit padding). */
  get bytePosition(): number {
    return this.bitCount > 0 ? this.position - 1 : this.position;
  }

  skipTo(byteOffset: number): void {
    this.position = byteOffset;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
}

type HuffmanTable = { count: number[]; symbol: number[] };

function buildHuffman(lengths: Uint16Array): HuffmanTable {
  const count = new Array(16).fill(0) as number[];
  for (const length of lengths) {
    if (length > 15) throw new ZipError("Invalid DEFLATE code length.");
    count[length] += 1;
  }
  if (count[0] === lengths.length) {
    // All-zero lengths: legal for an empty distance table.
    return { count, symbol: [] };
  }
  // Check for an over-subscribed set of lengths.
  let left = 1;
  for (let len = 1; len <= 15; len += 1) {
    left = (left << 1) - count[len];
    if (left < 0) throw new ZipError("Over-subscribed DEFLATE code lengths.");
  }
  const offsets = new Array(16).fill(0) as number[];
  for (let len = 1; len < 15; len += 1) {
    offsets[len + 1] = offsets[len] + count[len];
  }
  const symbol = new Array(lengths.length).fill(0) as number[];
  for (let i = 0; i < lengths.length; i += 1) {
    if (lengths[i] !== 0) {
      symbol[offsets[lengths[i]]] = i;
      offsets[lengths[i]] += 1;
    }
  }
  return { count, symbol };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= 15; len += 1) {
    code |= reader.readBit();
    const counted = table.count[len];
    if (code - first < counted) return table.symbol[index + (code - first)];
    index += counted;
    first = (first + counted) << 1;
    code <<= 1;
  }
  throw new ZipError("Invalid DEFLATE code.");
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
  67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
  5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
  769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
  11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Growable byte sink with a hard ceiling. */
class OutputBuffer {
  bytes: Uint8Array;
  length = 0;

  constructor(capacity: number) {
    this.bytes = new Uint8Array(Math.max(capacity, 1));
  }

  push(byte: number): void {
    if (this.length >= this.bytes.length) {
      if (this.bytes.length >= MAX_OUTPUT_BYTES) {
        throw new ZipError("Decompressed data exceeds the size limit.");
      }
      const grown = new Uint8Array(
        Math.min(this.bytes.length * 2, MAX_OUTPUT_BYTES),
      );
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes[this.length] = byte;
    this.length += 1;
  }
}

/** Decode a raw DEFLATE stream (no zlib/gzip wrapper). */
export function inflateRaw(input: Uint8Array, expectedSize: number): Uint8Array {
  if (expectedSize > MAX_OUTPUT_BYTES) {
    throw new ZipError("Compressed entry is unreasonably large.");
  }
  const reader = new BitReader(input);
  const out = new OutputBuffer(expectedSize);

  const inflateBlock = (
    litTable: HuffmanTable,
    distTable: HuffmanTable,
  ): void => {
    for (;;) {
      const symbol = decodeSymbol(reader, litTable);
      if (symbol < 256) {
        out.push(symbol);
      } else if (symbol === 256) {
        return;
      } else {
        const lengthIndex = symbol - 257;
        if (lengthIndex >= LENGTH_BASE.length) {
          throw new ZipError("Invalid DEFLATE length symbol.");
        }
        const length =
          LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
        const distanceSymbol = decodeSymbol(reader, distTable);
        if (distanceSymbol >= DISTANCE_BASE.length) {
          throw new ZipError("Invalid DEFLATE distance symbol.");
        }
        const distance =
          DISTANCE_BASE[distanceSymbol] +
          reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
        if (distance > out.length) {
          throw new ZipError("DEFLATE distance reaches before stream start.");
        }
        for (let i = 0; i < length; i += 1) {
          out.push(out.bytes[out.length - distance]);
        }
      }
    }
  };

  let final = false;
  while (!final) {
    final = reader.readBit() === 1;
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      // Stored block: skip to byte boundary, LEN/NLEN, raw copy.
      reader.alignToByte();
      const start = reader.bytePosition;
      if (start + 4 > input.length) {
        throw new ZipError("Truncated stored block in DEFLATE stream.");
      }
      const len = input[start] | (input[start + 1] << 8);
      const nlen = input[start + 2] | (input[start + 3] << 8);
      if ((len ^ 0xffff) !== nlen) {
        throw new ZipError("Corrupted stored block in DEFLATE stream.");
      }
      reader.skipTo(start + 4);
      for (let i = 0; i < len; i += 1) {
        if (reader.bytePosition >= input.length) {
          throw new ZipError("Truncated stored block data.");
        }
        out.push(input[reader.bytePosition]);
        reader.skipTo(reader.bytePosition + 1);
      }
    } else if (blockType === 1) {
      const litLengths = new Uint16Array(288);
      for (let i = 0; i < 144; i += 1) litLengths[i] = 8;
      for (let i = 144; i < 256; i += 1) litLengths[i] = 9;
      for (let i = 256; i < 280; i += 1) litLengths[i] = 7;
      for (let i = 280; i < 288; i += 1) litLengths[i] = 8;
      const distLengths = new Uint16Array(30).fill(5);
      inflateBlock(buildHuffman(litLengths), buildHuffman(distLengths));
    } else if (blockType === 2) {
      const hlit = reader.readBits(5) + 257;
      const hdist = reader.readBits(5) + 1;
      const hclen = reader.readBits(4) + 4;
      const codeLengthLengths = new Uint16Array(19);
      for (let i = 0; i < hclen; i += 1) {
        codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.readBits(3);
      }
      const codeLengthTable = buildHuffman(codeLengthLengths);
      const lengths = new Uint16Array(hlit + hdist);
      let index = 0;
      while (index < lengths.length) {
        const symbol = decodeSymbol(reader, codeLengthTable);
        if (symbol < 16) {
          lengths[index] = symbol;
          index += 1;
        } else if (symbol === 16) {
          if (index === 0) throw new ZipError("Invalid repeat at stream start.");
          const previous = lengths[index - 1];
          const repeat = 3 + reader.readBits(2);
          for (let i = 0; i < repeat; i += 1) lengths[index + i] = previous;
          index += repeat;
        } else if (symbol === 17) {
          index += 3 + reader.readBits(3);
        } else {
          index += 11 + reader.readBits(7);
        }
        if (index > lengths.length) {
          throw new ZipError("DEFLATE code length repeat overflows table.");
        }
      }
      inflateBlock(
        buildHuffman(lengths.subarray(0, hlit)),
        buildHuffman(lengths.subarray(hlit)),
      );
    } else {
      throw new ZipError("Invalid DEFLATE block type.");
    }
  }

  if (out.length !== expectedSize) {
    throw new ZipError(
      `DEFLATE output size mismatch (got ${out.length}, expected ${expectedSize}).`,
    );
  }
  return out.bytes.subarray(0, out.length);
}

export type ZipPackage = {
  /** Package root prefix inside the archive ("" when files sit at root). */
  prefix: string;
  entries: ZipEntry[];
  files: Map<string, Uint8Array>;
  manifestEntry: string;
};

const MAX_PACKAGE_ENTRIES = 4096;
const MAX_PACKAGE_UNCOMPRESSED = 64 * 1024 * 1024;
const MANIFEST_NAME = "plugin.json";

function readEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  localOffset: number,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (localOffset + 30 > bytes.length || U32(view, localOffset) !== 0x0403_4b50) {
    throw new ZipError(`Corrupted archive entry "${entry.name}".`);
  }
  const nameLength = U16(view, localOffset + 26);
  const extraLength = U16(view, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > bytes.length) {
    throw new ZipError(`Truncated archive entry "${entry.name}".`);
  }
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (compressed.length !== entry.size) {
      throw new ZipError(`Stored entry "${entry.name}" has a bad size.`);
    }
    data = compressed.slice();
  } else if (entry.method === 8) {
    data = inflateRaw(compressed, entry.size);
  } else {
    throw new ZipError(
      `Unsupported compression method ${entry.method} for "${entry.name}".`,
    );
  }
  if (crc32(data) !== entry.crc32) {
    throw new ZipError(`Integrity check failed for "${entry.name}".`);
  }
  return data;
}

function isSymlink(entry: ZipEntry): boolean {
  const posixMode = (entry.externalAttributes >>> 16) & 0o170000;
  return posixMode === 0o120000;
}

/**
 * Validate a plugin package and extract it fully into memory (plugin
 * packages are small; extraction to disk happens later, atomically, in the
 * installer). Handles packages whose files sit under a single top-level
 * folder (e.g. GitHub archive ZIPs: `repo-main/plugin.json`).
 *
 * Throws ZipError/ManifestError on any structural, integrity, or path
 * safety problem.
 */
export function readPluginPackage(bytes: Uint8Array): ZipPackage {
  if (bytes.length < 22) throw new ZipError("Plugin package is too small.");
  if (!isZip(bytes)) throw new ZipError("Plugin package is not a ZIP archive.");

  const { entries, offsets } = findCentralDirectory(bytes);
  if (entries.length === 0) throw new ZipError("Plugin package is empty.");
  if (entries.length > MAX_PACKAGE_ENTRIES) {
    throw new ZipError("Plugin package contains too many files.");
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    validateEntryName(entry.name);
    if (isSymlink(entry)) {
      throw new ZipError(`Unsafe archive entry: "${entry.name}" (symlink).`);
    }
    totalUncompressed += entry.size;
  }
  if (totalUncompressed > MAX_PACKAGE_UNCOMPRESSED) {
    throw new ZipError("Plugin package is too large when extracted.");
  }

  // Determine the package root: either the archive root or a single
  // top-level directory holding plugin.json (GitHub-style archives).
  const topLevel = new Set(
    entries
      .map((entry) => validateEntryName(entry.name))
      .filter(Boolean)
      .map((name) => name.split("/")[0]),
  );
  let prefix = "";
  if (!offsets.has(MANIFEST_NAME)) {
    if (topLevel.size === 1) {
      const candidate = `${[...topLevel][0]}/`;
      if (offsets.has(`${candidate}${MANIFEST_NAME}`)) {
        prefix = candidate;
      }
    }
  }
  if (!offsets.has(`${prefix}${MANIFEST_NAME}`)) {
    throw new ZipError("plugin.json is missing from the plugin package.");
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const name = validateEntryName(entry.name);
    if (!name || !name.startsWith(prefix) || name.endsWith("/")) continue;
    const data = readEntry(bytes, entry, offsets.get(entry.name) ?? -1);
    files.set(name.slice(prefix.length), data);
  }
  if (!files.has(MANIFEST_NAME)) {
    throw new ZipError("plugin.json is missing from the plugin package.");
  }

  return {
    entries,
    files,
    manifestEntry: `${prefix}${MANIFEST_NAME}`,
    prefix,
  };
}

/** Decode a UTF-8 text file from an extracted package. */
export function packageText(files: Map<string, Uint8Array>, name: string): string | null {
  const data = files.get(name);
  if (!data) return null;
  return new TextDecoder().decode(data);
}



