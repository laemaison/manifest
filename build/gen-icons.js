// Generates the PWA icons as PNGs with no image dependencies.
// Full-bleed canvas colour with a centred dark band, kept inside the
// maskable safe zone so Android can crop it to any shape.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [0xd9, 0xd3, 0xc0]; // --canvas
const INK = [0x1b, 0x20, 0x19]; // --ink

let table = null;
function crcTable() {
  if (table) return table;
  table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function makePng(size) {
  // Raw scanlines: one filter byte (0 = none) then RGB triples.
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);

  const bandTop = Math.round(size * 0.38);
  const bandBottom = Math.round(size * 0.62);
  const bandLeft = Math.round(size * 0.18);
  const bandRight = Math.round(size * 0.82);

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    const inBandY = y >= bandTop && y < bandBottom;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      const inBand = inBandY && x >= bandLeft && x < bandRight;
      const c = inBand ? INK : BG;
      raw[px] = c[0];
      raw[px + 1] = c[1];
      raw[px + 2] = c[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, "..");
for (const size of [192, 512]) {
  const out = path.join(root, `icon-${size}.png`);
  fs.writeFileSync(out, makePng(size));
  console.log("wrote", path.basename(out), fs.statSync(out).size + "B");
}
