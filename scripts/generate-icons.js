/**
 * Generate TROVE Calc favicon + PWA icon assets (pure Node / zlib).
 * Output:
 *   favicon/  — browser favicons
 *   icons/    — installable app icons
 *   assets/   — brand logo SVG (source of truth remains hand-authored)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const FAVICON_DIR = path.join(ROOT, "favicon");
const ICONS_DIR = path.join(ROOT, "icons");
const ASSETS_DIR = path.join(ROOT, "assets");

/* Brand green + cream (matches TROVE palette) */
const BLUE = [0x26, 0x62, 0x10, 0xff];
const WHITE = [0xe1, 0xdc, 0xc9, 0xff];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function setPx(data, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = color[0];
  data[i + 1] = color[1];
  data[i + 2] = color[2];
  data[i + 3] = color[3];
}

function fillRect(data, size, x0, y0, w, h, color, r = 0) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (r > 0) {
        const inCorner = (cx, cy) => {
          const dx = x - cx;
          const dy = y - cy;
          return dx * dx + dy * dy <= r * r;
        };
        const left = x < x0 + r;
        const right = x >= x1 - r;
        const top = y < y0 + r;
        const bottom = y >= y1 - r;
        if (left && top && !inCorner(x0 + r, y0 + r)) continue;
        if (right && top && !inCorner(x1 - 1 - r, y0 + r)) continue;
        if (left && bottom && !inCorner(x0 + r, y1 - 1 - r)) continue;
        if (right && bottom && !inCorner(x1 - 1 - r, y1 - 1 - r)) continue;
      }
      setPx(data, size, x, y, color);
    }
  }
}

function drawIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  const s = size / 32;
  const round = Math.max(2, Math.round(8 * s));
  fillRect(data, size, 0, 0, size, size, BLUE, round);
  const barR = Math.max(1, Math.round(2 * s));
  fillRect(
    data,
    size,
    Math.round(6 * s),
    Math.round(6 * s),
    Math.round(20 * s),
    Math.max(2, Math.round(6 * s)),
    WHITE,
    barR
  );
  const stemW = Math.max(2, Math.round(6 * s));
  fillRect(
    data,
    size,
    Math.round((32 * s - stemW) / 2),
    Math.round(13 * s),
    stemW,
    Math.round(13 * s),
    WHITE,
    barR
  );
  if (size >= 128) {
    const hint = [0xff, 0xff, 0xff, 0x48];
    const hw = Math.round(4.5 * s);
    const hh = Math.round(3.5 * s);
    const hy = Math.round(22.5 * s);
    fillRect(data, size, Math.round(6 * s), hy, hw, hh, hint, Math.round(s));
    fillRect(data, size, Math.round(21.5 * s), hy, hw, hh, hint, Math.round(s));
  }
  return data;
}

function writePNG(dir, filename, size) {
  const png = encodePNG(size, size, drawIcon(size));
  fs.writeFileSync(path.join(dir, filename), png);
  console.log("wrote", path.relative(ROOT, path.join(dir, filename)));
}

function writeICO(dir, filename, sizes) {
  const images = sizes.map((size) => ({
    size,
    png: encodePNG(size, size, drawIcon(size)),
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dirs = [];
  const payloads = [];
  for (const img of images) {
    const dirEntry = Buffer.alloc(16);
    dirEntry[0] = img.size >= 256 ? 0 : img.size;
    dirEntry[1] = img.size >= 256 ? 0 : img.size;
    dirEntry.writeUInt16LE(1, 4);
    dirEntry.writeUInt16LE(32, 6);
    dirEntry.writeUInt32LE(img.png.length, 8);
    dirEntry.writeUInt32LE(offset, 12);
    dirs.push(dirEntry);
    payloads.push(img.png);
    offset += img.png.length;
  }
  fs.writeFileSync(
    path.join(dir, filename),
    Buffer.concat([header, ...dirs, ...payloads])
  );
  console.log("wrote", path.relative(ROOT, path.join(dir, filename)));
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#266210"/>
  <rect x="6" y="6" width="20" height="6" rx="2" fill="#E1DCC9"/>
  <rect x="13" y="13" width="6" height="13" rx="2" fill="#E1DCC9"/>
</svg>
`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="TROVE Calc">
  <rect width="512" height="512" rx="112" fill="#266210"/>
  <rect x="88" y="92" width="336" height="88" rx="28" fill="#E1DCC9"/>
  <rect x="200" y="200" width="112" height="220" rx="28" fill="#E1DCC9"/>
  <rect x="96" y="360" width="72" height="56" rx="16" fill="#E1DCC9" opacity="0.28"/>
  <rect x="344" y="360" width="72" height="56" rx="16" fill="#E1DCC9" opacity="0.28"/>
</svg>
`;

ensureDir(FAVICON_DIR);
ensureDir(ICONS_DIR);
ensureDir(ASSETS_DIR);

fs.writeFileSync(path.join(FAVICON_DIR, "favicon.svg"), FAVICON_SVG);
fs.writeFileSync(path.join(ASSETS_DIR, "logo.svg"), LOGO_SVG);
// Root copies for default browser / crawler discovery
fs.writeFileSync(path.join(ROOT, "favicon.svg"), FAVICON_SVG);

writePNG(FAVICON_DIR, "favicon-16x16.png", 16);
writePNG(FAVICON_DIR, "favicon-32x32.png", 32);
writePNG(ICONS_DIR, "apple-touch-icon.png", 180);
writePNG(ICONS_DIR, "android-chrome-192x192.png", 192);
writePNG(ICONS_DIR, "android-chrome-512x512.png", 512);
writePNG(ICONS_DIR, "maskable-512x512.png", 512);
writeICO(FAVICON_DIR, "favicon.ico", [16, 32]);
fs.copyFileSync(
  path.join(FAVICON_DIR, "favicon.ico"),
  path.join(ROOT, "favicon.ico")
);

console.log("Icon generation complete.");
