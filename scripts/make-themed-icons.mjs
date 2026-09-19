/**
 * Generate per-theme launcher icons from `assets/images/icon-aqua.png`.
 *
 * Pure Node (zlib only): PNG decode (8-bit truecolor/truecolor+alpha, all
 * filters) → per-pixel hue rotation toward each variant's theme hue →
 * RGBA encode. The `aqua` variant IS the source artwork (default launcher
 * icon); only shifted variants are written to `assets/images/icon-*.png`.
 *
 * Usage: `npm run vendor:themed-icons`. Deterministic: same source bytes
 * produce identical outputs, so re-running is a no-op unless art changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";

import {
  hueDelta,
  shiftPixel,
  SOURCE_HUE,
  THEMED_ICON_VARIANTS,
} from "./themed-icon-specs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SRC = join(root, "assets", "images", "icon-aqua.png");
const IMAGES = join(root, "assets", "images");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crcBytes]);
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG depth=${bitDepth} type=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(y * width * 4, (y + 1) * width * 4);
    const prev =
      y === 0
        ? Buffer.alloc(width * 4)
        : pixels.subarray((y - 1) * width * 4, y * width * 4);
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const sx = x * channels + c;
        const rawValue = c < channels ? row[sx] : 255;
        const a = x > 0 ? out[(x - 1) * 4 + c] : 0;
        const b = prev[x * 4 + c];
        const cc = x > 0 ? prev[(x - 1) * 4 + c] : 0;
        let value = rawValue;
        if (filter === 1) value = (value + a) & 0xff;
        else if (filter === 2) value = (value + b) & 0xff;
        else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
        else if (filter === 4) {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc)) & 0xff;
        }
        out[x * 4 + c] = value;
      }
    }
  }
  return { width, height, pixels };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function shiftArtwork(pixels, delta) {
  const out = Buffer.from(pixels);
  let shifted = 0;
  for (let i = 0; i < out.length; i += 4) {
    const next = shiftPixel(out[i], out[i + 1], out[i + 2], delta);
    if (next) {
      out[i] = next[0];
      out[i + 1] = next[1];
      out[i + 2] = next[2];
      shifted += 1;
    }
  }
  return { out, shifted };
}

// Two jobs share one pipeline: opaque launcher icons and the transparent
// splash mark. The aqua variant of each IS its source file.
const JOBS = [
  { src: SRC, prefix: "icon" },
  { src: join(IMAGES, "splash-icon-aqua.png"), prefix: "splash-icon" },
];

for (const job of JOBS) {
  const { width, height, pixels } = decodePng(readFileSync(job.src));
  if (width !== height) {
    throw new Error(`expected square artwork, got ${width}x${height}`);
  }

  for (const spec of THEMED_ICON_VARIANTS) {
    if (!spec.aliasSuffix) {
      console.log(`${job.prefix}/${spec.variant}: source artwork (default)`);
      continue;
    }
    const file = `${job.prefix}-${spec.variant}.png`;
    const delta = hueDelta(SOURCE_HUE, spec.hue);
    const { out, shifted } = shiftArtwork(pixels, delta);
    const png = encodePng(width, height, out);
    writeFileSync(join(IMAGES, file), png);
    console.log(
      `${job.prefix}/${spec.variant}: assets/images/${file} (${(png.length / 1024).toFixed(0)} KiB, hue ${SOURCE_HUE}→${spec.hue}, ${(100 * shifted / (width * height)).toFixed(1)}% pixels shifted)`,
    );
  }
}
