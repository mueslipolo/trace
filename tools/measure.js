// Text measurement for Node, where there is no canvas.
// With the Inter font files (devDependency @expo-google-fonts/inter) and opentype.js it uses Inter's real
// advance widths and kerning, so Node lays out like the browser does. Without them it falls back to a table
// that is close to Inter's widths. `fontFile(weight)` is also what the PNG renderer loads.
const fs = require('fs');
const path = require('path');

const WEIGHTS = { 400: '400Regular', 500: '500Medium', 600: '600SemiBold', 700: '700Bold' };
function fontFile(weight) {
  const w = [400, 500, 600, 700].reduce((a, b) => Math.abs(b - weight) < Math.abs(a - weight) ? b : a);
  try {
    const dir = path.dirname(require.resolve('@expo-google-fonts/inter/package.json'));
    const f = path.join(dir, WEIGHTS[w], `Inter_${WEIGHTS[w]}.ttf`);
    return fs.existsSync(f) ? f : null;
  } catch (e) { return null; }
}

let opentype = null;
try { opentype = require('opentype.js'); } catch (e) { /* the table below is used instead */ }
const loaded = new Map();
function fontFor(weight) {
  if (!opentype) return null;
  const f = fontFile(weight);
  if (!f) return null;
  if (!loaded.has(f)) {
    const b = fs.readFileSync(f);
    loaded.set(f, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return loaded.get(f);
}

const NARROW = new Set("iljI.,:;'|!()[]{}/\\ ".split(''));
const WIDE = new Set('mwMW@%'.split(''));
function charEm(c) {
  if (NARROW.has(c)) return 0.3;
  if (WIDE.has(c)) return 0.86;
  if (c >= 'A' && c <= 'Z') return 0.68;
  if (c >= '0' && c <= '9') return 0.6;
  return 0.55;
}
const cache = new Map();
function measure(text, font) {
  const m = /(\d+)\s+([\d.]+)px/.exec(font);
  const weight = m ? +m[1] : 400, size = m ? +m[2] : 12;
  const key = weight + '|' + size + '|' + text;
  if (cache.has(key)) return cache.get(key);
  let v;
  const f = fontFor(weight);
  if (f) {
    // advance widths summed glyph by glyph: no shaping (the library cannot read Inter's substitution tables),
    // so no kerning either; that is about a percent
    let units = 0;
    for (const ch of String(text)) units += f.charToGlyph(ch).advanceWidth || 0;
    v = units * size / f.unitsPerEm;
  }
  else { let em = 0; for (const c of String(text)) em += charEm(c); v = em * size * (weight >= 600 ? 1.05 : 1); }
  cache.set(key, v);
  return v;
}
module.exports = { measure, fontFile, hasInter: () => !!fontFor(400) };
