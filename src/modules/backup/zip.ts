/**
 * Minimal ZIP archive reader/writer (STORE method only — no compression).
 *
 * Backup archives are small JSON documents; stored (uncompressed) entries
 * keep this dependency-free (no jszip/fflate in the APK) and fully
 * deterministic. Pure functions over Uint8Array: no platform imports, so
 * this unit-tests on node and runs identically on device.
 *
 * Format: local file headers + central directory + EOCD, UTF-8 names,
 * CRC32 per entry (also reused as the manifest checksum). Only method 0
 * is accepted on read; anything else is rejected rather than guessed at.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(bytes: Uint8Array): string {
  return crc32Bytes(bytes).toString(16).padStart(8, "0");
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

export type ZipEntryInput = {
  name: string;
  data: Uint8Array;
};

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

/**
 * Build a ZIP archive from named entries. Names must be relative,
 * slash-separated, and free of `..` segments — anything else throws
 * before a single byte is written.
 */
export function buildZip(entries: ZipEntryInput[]): Uint8Array {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.name ||
      entry.name.startsWith("/") ||
      entry.name.includes("\\") ||
      entry.name.split("/").includes("..")
    ) {
      throw new Error(`Unsafe zip entry name: "${entry.name}".`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate zip entry name: "${entry.name}".`);
    }
    seen.add(entry.name);
  }

  const encoded = entries.map((entry) => ({
    crc: crc32Bytes(entry.data),
    data: entry.data,
    nameBytes: encodeName(entry.name),
  }));
  const localSize = encoded.reduce(
    (sum, entry) => sum + 30 + entry.nameBytes.length + entry.data.length,
    0,
  );
  const centralSize = encoded.reduce(
    (sum, entry) => sum + 46 + entry.nameBytes.length,
    0,
  );
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const centralOffsets: number[] = [];

  for (const entry of encoded) {
    centralOffsets.push(offset);
    writeU32(view, offset, LOCAL_HEADER);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 0x0800);
    writeU16(view, offset + 8, 0);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, 0);
    writeU32(view, offset + 14, entry.crc);
    writeU32(view, offset + 18, entry.data.length);
    writeU32(view, offset + 22, entry.data.length);
    writeU16(view, offset + 26, entry.nameBytes.length);
    writeU16(view, offset + 28, 0);
    offset += 30;
    out.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
    out.set(entry.data, offset);
    offset += entry.data.length;
  }

  const centralStart = offset;
  encoded.forEach((entry, index) => {
    writeU32(view, offset, CENTRAL_HEADER);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 20);
    writeU16(view, offset + 8, 0x0800);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, 0);
    writeU16(view, offset + 14, 0);
    writeU32(view, offset + 16, entry.crc);
    writeU32(view, offset + 20, entry.data.length);
    writeU32(view, offset + 24, entry.data.length);
    writeU16(view, offset + 28, entry.nameBytes.length);
    for (let i = 30; i < 46; i += 1) view.setUint8(offset + i, 0);
    offset += 46;
    out.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
    void centralOffsets[index];
  });

  // Patch the recorded local-header offsets into the central entries.
  let centralCursor = centralStart;
  for (let i = 0; i < encoded.length; i += 1) {
    writeU32(view, centralCursor + 42, centralOffsets[i]!);
    centralCursor += 46 + encoded[i]!.nameBytes.length;
  }

  writeU32(view, offset, END_OF_CENTRAL_DIR);
  writeU16(view, offset + 4, 0);
  writeU16(view, offset + 6, 0);
  writeU16(view, offset + 8, encoded.length);
  writeU16(view, offset + 10, encoded.length);
  writeU32(view, offset + 12, centralSize);
  writeU32(view, offset + 14, centralStart);
  writeU16(view, offset + 16, 0);
  return out;
}

export type ZipEntryOutput = {
  name: string;
  data: Uint8Array;
};

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/**
 * Parse a ZIP archive produced by buildZip (or any store-method writer).
 * Validates signatures, CRC32 per entry, and rejects unsafe names,
 * compressed entries, and archives with directory traversal.
 */
export function parseZip(bytes: Uint8Array): ZipEntryOutput[] {
  if (bytes.length < 22) throw new Error("Not a zip archive: too small.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate EOCD by scanning backwards (a comment may follow it).
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanStart; i -= 1) {
    if (readU32(view, i) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive: end record missing.");
  const entryCount = readU16(view, eocd + 10);
  const centralStart = readU32(view, eocd + 14);
  const entries: ZipEntryOutput[] = [];
  let cursor = centralStart;
  const decoder = new TextDecoder();
  for (let i = 0; i < entryCount; i += 1) {
    if (readU32(view, cursor) !== CENTRAL_HEADER) {
      throw new Error("Not a zip archive: central directory corrupt.");
    }
    const method = readU16(view, cursor + 10);
    if (method !== 0) {
      throw new Error("Unsupported zip compression method (only stored).");
    }
    const crc = readU32(view, cursor + 16);
    const size = readU32(view, cursor + 20);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const name = decoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      throw new Error(`Unsafe zip entry name: "${name}".`);
    }
    if (readU32(view, localOffset) !== LOCAL_HEADER) {
      throw new Error(`Zip entry "${name}" has a corrupt local header.`);
    }
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (data.length !== size) {
      throw new Error(`Zip entry "${name}" is truncated.`);
    }
    if (crc32Bytes(data) !== crc) {
      throw new Error(`Zip entry "${name}" failed integrity check.`);
    }
    entries.push({ data: data.slice(), name });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
