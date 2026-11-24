#!/usr/bin/env node
// Usage: node tools/render.js diagram.trace [out.svg | out.png] [--dark] [--light] [--zoom 2] [--watch]
//   no output file   the SVG goes to stdout
//   out.svg          a standalone SVG (follows prefers-color-scheme unless --dark or --light is given)
//   out.png          a PNG (needs @resvg/resvg-js; text uses Inter when the font devDependency is installed)
//   --watch          draw again whenever the file changes, until interrupted
// Problems are printed with line numbers; warnings (an icon that could not load, an align that could not
// be done) are printed after the drawing.
const fs = require('fs');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('./measure.js');
const { toPng, available } = require('./png.js');

const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const dark = flag('--dark'), light = flag('--light'), watch = flag('--watch');
let zoom = 1.5;
{ const i = args.indexOf('--zoom'); if (i >= 0) { zoom = parseFloat(args[i + 1]) || zoom; args.splice(i, 2); } }
const [inp, out] = args;
if (!inp || (dark && light)) { console.error('Usage: node tools/render.js diagram.trace [out.svg | out.png] [--dark | --light] [--zoom 2] [--watch]'); process.exit(2); }
const theme = dark ? 'dark' : light ? 'light' : null;
const png = out && /\.png$/i.test(out);
if (png && !available()) { console.error('PNG output needs @resvg/resvg-js: run npm install'); process.exit(2); }

async function once() {
  let src;
  try { src = fs.readFileSync(inp, 'utf8'); } catch (e) { console.error(`Cannot read ${inp}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); return false; }
  const res = await compile(src, measure, ELK, {});
  if (res.errors.length) {
    for (const e of res.errors) console.error(`${inp}:${e.line}: ${e.msg}`);
    return false;
  }
  if (res.empty) { console.error(`${inp}: nothing to draw`); return false; }
  // a PNG has no media queries to follow: it is light unless --dark
  const svg = res.standalone(png ? (theme || 'light') : theme);
  if (!out) process.stdout.write(svg);
  else fs.writeFileSync(out, png ? toPng(svg, { zoom, dark: theme === 'dark' }) : svg);
  for (const w of res.warnings || []) console.error(`${inp}: ${w}`);
  if (out) console.error(`${out}: ${Math.round(res.rm.width)} x ${Math.round(res.rm.height)}`);
  return true;
}

(async () => {
  const ok = await once();
  if (!watch) process.exit(ok ? 0 : 1);
  console.error(`watching ${inp} (Ctrl-C to stop)`);
  let timer = 0;
  fs.watch(inp, () => { clearTimeout(timer); timer = setTimeout(() => once().catch(e => console.error(e.message)), 120); });
})();
