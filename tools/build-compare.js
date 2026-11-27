#!/usr/bin/env node
// Builds dist/compare.html: every held-out diagram (examples/holdout) three times, side by side: by Trace as first
// written, by Trace with its full features (examples/holdout/full, when there is one), and by Mermaid. Each
// <name>.trace has its Mermaid version in <name>.mmd: the original for the diagrams that came from Mermaid, a
// flowchart written from the same model for the C4 ones.
//
// The two Trace columns are drawn here, in Node (text measured with tools/measure.js, as for the snapshots), and
// written into the page as SVG: the page needs no script for them, so a pipeline can build, archive and diff it.
// The Mermaid column is drawn live in the browser (Mermaid 11.17.2 from jsDelivr).
//
//   node tools/build-compare.js                  writes dist/compare.html
//   node tools/build-compare.js --out <file>     writes it there instead
// Exits with 1 when a diagram could not be drawn (the page still shows the others and says why).
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile, diagramCSS, PALETTE } = require('../src/trace.js');
const { measure } = require('./measure.js');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'examples/holdout');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 && args[outAt + 1] ? path.resolve(args[outAt + 1]) : path.join(root, 'dist/compare.html');

// a drawing, or the reason there is none (the page shows it in place of the drawing)
async function draw(src, idPrefix) {
  try {
    const r = await compile(src, measure, ELK, { idPrefix });
    if (r.errors.length) return { error: `Line ${r.errors[0].line}: ${r.errors[0].msg}` };
    return { svg: r.svg };
  } catch (e) { return { error: 'The layout engine couldn’t place this one.' }; }
}

(async () => {
  const ids = fs.readdirSync(dir).filter(f => f.endsWith('.trace')).sort().map(f => f.replace(/\.trace$/, ''));
  const cases = [];
  for (const [i, id] of ids.entries()) {
    const trace = fs.readFileSync(path.join(dir, id + '.trace'), 'utf8');
    const mmdPath = path.join(dir, id + '.mmd');
    if (!fs.existsSync(mmdPath)) throw new Error(`examples/holdout/${id}.trace has no ${id}.mmd next to it: write its Mermaid version`);
    const mermaid = fs.readFileSync(mmdPath, 'utf8');
    // the same diagram written with Trace's full features (icons, rows and columns, span, mark, join...), when there is one
    const fullPath = path.join(dir, 'full', id + '.trace');
    const full = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
    const title = (trace.match(/^title\s+"([^"]*)"/m) || [, id])[1];
    const origin = (trace.match(/^#\s*(.*)$/m) || [, ''])[1];
    // the Mermaid files written for this page say so on their first line; the others are the originals
    const written = /^%%\s*Written for comparison/.test(mermaid);
    const converted = /^Converted with/.test(origin);
    const from = origin.replace(/^Converted with tools\/mermaid-to-trace\.js from /, 'From ').replace(/; original in .*$/, '').replace(/^Adapted from /, 'From ');
    const traceSide = converted ? 'the Trace side is converted from it with no layout help' : 'the Trace side is adapted by hand with no layout help';
    const context = written
      ? `${from}. The Trace side is adapted by hand with no layout help; the Mermaid side is a flowchart written from the same nodes and links.`
      : `${from}. The Mermaid side is the original; ${traceSide}.`;
    const plain = await draw(trace, 'h' + i), fancy = full ? await draw(full, 'f' + i) : {};
    cases.push({ id, title, context, trace, full, mermaid, svg: plain.svg || '', error: plain.error || '', fsvg: fancy.svg || '', ferror: fancy.error || '' });
    process.stdout.write(plain.error || fancy.error ? '!' : '.');
  }
  process.stdout.write('\n');

  // the drawings' stylesheet, for the light and the dark theme
  const L = PALETTE.light, D = PALETTE.dark;
  const css = diagramCSS(L, '.dg') + `@media (prefers-color-scheme: dark){${diagramCSS(D, ':root:not([data-theme="light"]) .dg')}}` + diagramCSS(D, ':root[data-theme="dark"] .dg');
  const nav = cases.map((c, i) => `<li><a href="#${c.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.title)}</span></a></li>`).join('');
  const options = cases.map((c, i) => `<option value="${c.id}">${String(i + 1).padStart(2, '0')} ${esc(c.title)}</option>`).join('');
  let page = fs.readFileSync(path.join(root, 'playground/compare-template.html'), 'utf8');
  page = page
    .replace('@@NAV@@', () => nav)
    .replace('@@OPTIONS@@', () => options)
    .replace('/*DGCSS*/', () => css)
    .replace('/*CASES*/', () => 'const CASES = ' + JSON.stringify(cases).replace(/</g, '\\u003c') + ';');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page);
  const failed = cases.filter(c => c.error || c.ferror);
  console.log(path.relative(process.cwd(), out), page.length, 'bytes,', cases.length, 'diagrams' + (failed.length ? `; not drawn: ${failed.map(c => c.id).join(', ')}` : ''));
  if (failed.length) process.exitCode = 1;
})();
