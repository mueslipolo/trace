#!/usr/bin/env node
// Renders every example to out/<group>/<name>.svg, and .png when @resvg/resvg-js is installed.
// Look at the PNGs after any layout change: that is how regressions were caught while building Trace.
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('./measure.js');
let Resvg = null;
try { ({ Resvg } = require('@resvg/resvg-js')); } catch (e) { /* PNGs are optional */ }
// resvg needs a font to draw text: use DejaVu when it is installed (a stand-in for Inter, a little wider),
// otherwise the PNGs have shapes and no text
const FONT_DIR = '/usr/share/fonts/truetype/dejavu/';
const FONT_FILES = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map(f => FONT_DIR + f).filter(f => fs.existsSync(f));

(async () => {
  const root = path.join(__dirname, '..');
  let failed = 0;
  for (const group of ['playground', 'cases', 'cases/simple']) {
    const dir = path.join(root, 'examples', group);
    const outDir = path.join(root, 'out', group);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.trace')).sort()) {
      const name = f.replace(/\.trace$/, '');
      const res = await compile(fs.readFileSync(path.join(dir, f), 'utf8'), measure, ELK, {});
      if (res.errors.length) { failed++; console.log(`✗ ${group}/${f}: line ${res.errors[0].line}: ${res.errors[0].msg}`); continue; }
      const svg = res.standalone();
      fs.writeFileSync(path.join(outDir, name + '.svg'), svg);
      if (Resvg) {
        // resvg ignores prefers-color-scheme and paint-order, so drop the halo for a readable PNG
        const forPng = svg.replace(/ halo/g, '').replace(/font:12px Inter,[^}]*\}/g, 'font-family:"DejaVu Sans";font-size:12px}');
        const png = new Resvg(forPng, { background: 'white', fitTo: { mode: 'zoom', value: 1.25 }, font: FONT_FILES.length ? { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' } : undefined }).render().asPng();
        fs.writeFileSync(path.join(outDir, name + '.png'), png);
      }
      console.log(`✓ ${group}/${name}  ${Math.round(res.rm.width)}×${Math.round(res.rm.height)}`);
    }
  }
  if (!Resvg) console.log('(install @resvg/resvg-js for PNG snapshots)');
  process.exit(failed ? 1 : 0);
})();
