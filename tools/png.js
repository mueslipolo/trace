// SVG to PNG with @resvg/resvg-js (optional). Text is drawn with the real Inter files when the font
// devDependency is installed (the same font the layout measures), otherwise the PNG has shapes and no text.
const { fontFile } = require('./measure.js');
let Resvg = null;
try { ({ Resvg } = require('@resvg/resvg-js')); } catch (e) { /* PNGs are optional */ }

function available() { return !!Resvg; }

// svg: a standalone SVG string. theme: 'light' | 'dark' (a fixed theme draws its own background).
function toPng(svg, { zoom = 1.25, dark = false, crop = null } = {}) {
  if (!Resvg) throw new Error('PNG output needs @resvg/resvg-js: run npm install');
  // resvg ignores paint-order, so drop the halo; it does not read the CSS font shorthand, so spell it out
  const clean = svg.replace(/ halo/g, '').replace(/font:12px Inter,[^}]*\}/g, 'font-family:Inter;font-size:12px}');
  const files = [400, 500, 600, 700].map(fontFile).filter(Boolean);
  const font = files.length ? { loadSystemFonts: false, fontFiles: files, defaultFontFamily: 'Inter' } : undefined;
  const img = new Resvg(clean, { background: dark ? '#181b21' : 'white', fitTo: { mode: 'zoom', value: zoom }, font }).render();
  if (!crop) return img.asPng();
  // a part of the drawing, cut from the pixels: resvg 2.6 can fail on a view box that cuts through arrowheads
  const k = zoom, x0 = Math.max(0, Math.round(crop.x * k)), y0 = Math.max(0, Math.round(crop.y * k));
  const w = Math.min(img.width - x0, Math.round(crop.w * k)), h = Math.min(img.height - y0, Math.round(crop.h * k));
  const px = img.pixels, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) px.copy(out, y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4);
  return encodePng(out, w, h);
}

// RGBA pixels to a PNG file (no filter, deflated)
function encodePng(rgba, w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const table = encodePng.t || (encodePng.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  const crc = b => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { toPng, available };
