#!/usr/bin/env node
// Builds dist/showcase.html: every case in examples/cases drawn live in the page from its Trace
// source. Case notes live in examples/cases/cases.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/cases/cases.json'), 'utf8'));
const { simplify } = require('./simplify.js');
const cases = meta.map(m => {
  const full = fs.readFileSync(path.join(root, 'examples/cases', m.id + '.trace'), 'utf8');
  const simple = fs.readFileSync(path.join(root, 'examples/cases/simple', m.id + '.trace'), 'utf8');
  return { ...m, trace: full, simple, stats: simplify(full).stats };
});
const LABELS = { icons: ['icon', 'icons'], span: ['span node', 'span nodes'], bridge: ['bridge', 'bridges'], top: ['icon on top', 'icons on top'], blocks: ['row or column', 'rows and columns'], rails: ['rail', 'rails'], sizing: ['same-width line', 'same-width lines'], reversed: ['reversed link', 'reversed links'] };
const adds = st => Object.entries(st).filter(([, v]) => v).map(([k, v]) => `${v} ${LABELS[k][v === 1 ? 0 : 1]}`).join(', ') || 'nothing: this diagram is already fine on its own';
const nav = cases.map(c => `<li><a href="#${c.id}">${esc(c.title)}</a></li>`).join('');
const cards = cases.map((c, i) => `
<section class="case" id="${c.id}" aria-labelledby="h-${c.id}">
  <header class="case-head">
    <span class="num">${String(i + 1).padStart(2, '0')}</span>
    <div>
      <h2 id="h-${c.id}">${esc(c.title)}</h2>
      <p class="context">${esc(c.context)}</p>
    </div>
  </header>
  <div class="pair">
    <figure class="panel">
      <figcaption><b>Simple</b>: nodes, links and frames, automatic layout</figcaption>
      <div class="canvas tr dgw" data-case="${i}" data-variant="simple"><div class="wait">Drawing…</div></div>
      <details class="src"><summary>Source</summary><div class="src-grid"><pre>${esc(c.simple)}</pre></div></details>
    </figure>
    <figure class="panel">
      <figcaption><b>Full</b>: adds ${esc(adds(c.stats))}</figcaption>
      <div class="canvas tr dgw" data-case="${i}" data-variant="trace"><div class="wait">Drawing…</div></div>
      <details class="src"><summary>Source</summary><div class="src-grid"><pre>${esc(c.trace)}</pre></div></details>
    </figure>
  </div>
  <div class="notes">
    <p><b>What the full version uses.</b> ${esc(c.uses)}</p>
    <p><b>Still missing.</b> ${esc(c.gap)}</p>
  </div>
</section>`).join('');
let page = fs.readFileSync(path.join(root, 'playground/showcase-template.html'), 'utf8');
page = page
  .replace('@@NAV@@', () => nav)
  .replace('@@CARDS@@', () => cards)
  .replace('/*CORE*/', () => ['lucide-core', 'lucide-names', 'trace'].map(n => fs.readFileSync(path.join(root, 'src', n + '.js'), 'utf8')).join('\n'))
  .replace('/*CASES*/', () => 'const CASES = ' + JSON.stringify(cases).replace(/</g, '\\u003c') + ';');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/showcase.html'), page);
console.log('dist/showcase.html', page.length, 'bytes');
