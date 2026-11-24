// SVG to PNG with @resvg/resvg-js (optional). Text is drawn with the real Inter files when the font
// devDependency is installed (the same font the layout measures), otherwise the PNG has shapes and no text.
const { fontFile } = require('./measure.js');
let Resvg = null;
try { ({ Resvg } = require('@resvg/resvg-js')); } catch (e) { /* PNGs are optional */ }

function available() { return !!Resvg; }

// svg: a standalone SVG string. theme: 'light' | 'dark' (a fixed theme draws its own background).
function toPng(svg, { zoom = 1.25, dark = false } = {}) {
  if (!Resvg) throw new Error('PNG output needs @resvg/resvg-js: run npm install');
  // resvg ignores paint-order, so drop the halo; it does not read the CSS font shorthand, so spell it out
  const clean = svg.replace(/ halo/g, '').replace(/font:12px Inter,[^}]*\}/g, 'font-family:Inter;font-size:12px}');
  const files = [400, 500, 600, 700].map(fontFile).filter(Boolean);
  const font = files.length ? { loadSystemFonts: false, fontFiles: files, defaultFontFamily: 'Inter' } : undefined;
  return new Resvg(clean, { background: dark ? '#181b21' : 'white', fitTo: { mode: 'zoom', value: zoom }, font }).render().asPng();
}
module.exports = { toPng, available };
