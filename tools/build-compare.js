#!/usr/bin/env node
// Builds dist/compare.html: every held-out diagram (examples/holdout) drawn by Trace and by Mermaid side by
// side, both live in the page, with the same diagram written with Trace's full features (examples/holdout/full) between them. Each <name>.trace has its Mermaid version in <name>.mmd: the original for the
// diagrams that came from Mermaid, a flowchart written from the same model for the C4 ones.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'examples/holdout');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cases = fs.readdirSync(dir).filter(f => f.endsWith('.trace')).sort().map(f => {
  const id = f.replace(/\.trace$/, '');
  const trace = fs.readFileSync(path.join(dir, f), 'utf8');
  const mmdPath = path.join(dir, id + '.mmd');
  if (!fs.existsSync(mmdPath)) throw new Error(`examples/holdout/${id}.trace has no ${id}.mmd next to it: write its Mermaid version`);
  const mermaid = fs.readFileSync(mmdPath, 'utf8');
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
  // the same diagram written with Trace's full features (icons, rows and columns, span, mark, join...), when there is one
  const fullPath = path.join(dir, 'full', id + '.trace');
  const full = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  return { id, title, context, trace, full, mermaid };
});

const nav = cases.map((c, i) => `<li><a href="#${c.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.title)}</span></a></li>`).join('');
const options = cases.map((c, i) => `<option value="${c.id}">${String(i + 1).padStart(2, '0')} ${esc(c.title)}</option>`).join('');
let page = fs.readFileSync(path.join(root, 'playground/compare-template.html'), 'utf8');
page = page
  .replace('@@NAV@@', () => nav)
  .replace('@@OPTIONS@@', () => options)
  .replace('/*CORE*/', () => ['lucide-core', 'lucide-names', 'logo-core', 'logo-names', 'trace'].map(n => fs.readFileSync(path.join(root, 'src', n + '.js'), 'utf8')).join('\n'))
  .replace('/*CASES*/', () => 'const CASES = ' + JSON.stringify(cases).replace(/</g, '\\u003c') + ';');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/compare.html'), page);
console.log('dist/compare.html', page.length, 'bytes,', cases.length, 'diagrams');
