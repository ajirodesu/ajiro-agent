/**
 * Build `assets/file-icons/ajiro.svg` — the `.ajiro` config file icon.
 *
 * Source: `assets/images/new-splash-icon.png` (transparent app artwork).
 * The PNG is downscaled to 256px and embedded as base64 inside a standard
 * SVG `<image>` wrapper, so the icon renders pixel-identical at any size
 * through the existing SvgXml pipeline with zero network access.
 *
 * Pure Node (zlib only): minimal PNG decode → box downscale → encode.
 * Usage: `npm run vendor:ajiro-icon` (or run automatically before
 * `vendor:file-icons`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SRC = join(root, "assets", "images", "new-splash-icon.png");
const OUT = join(root, "assets", "file-icons", "ajiro.svg");
const SIZE = 256;

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
        const has = c < channels;
        const rawValue = has ? row[sx] : 255;
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

function downscale(pixels, width, height, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = width / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(width, Math.ceil((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.min(height, Math.ceil((y + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
          n += 1;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
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

const { width, height, pixels } = decodePng(readFileSync(SRC));
if (width !== height) {
  throw new Error(`expected square artwork, got ${width}x${height}`);
}
const small = downscale(pixels, width, height, SIZE);
const png = encodePng(SIZE, SIZE, small);
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
  `<image width="${SIZE}" height="${SIZE}" href="data:image/png;base64,${png.toString("base64")}"/></svg>`;
writeFileSync(OUT, svg);
console.log(
  `ajiro icon written: assets/file-icons/ajiro.svg (${(svg.length / 1024).toFixed(0)} KiB, source ${width}x${height})`,
);
