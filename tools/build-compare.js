#!/usr/bin/env node
// Builds dist/compare.html: every case in examples/cases drawn by Mermaid (rendered by the viewer)
// next to Trace (drawn live in the page). Case notes live in examples/cases/cases.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/cases/cases.json'), 'utf8'));
const cases = meta.map(m => ({
  ...m,
  trace: fs.readFileSync(path.join(root, 'examples/cases', m.id + '.trace'), 'utf8'),
  mermaid: fs.readFileSync(path.join(root, 'examples/cases', m.id + '.mmd'), 'utf8'),
}));
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
      <figcaption>Mermaid, default rendering</figcaption>
      <div class="canvas mm"><pre class="mermaid">${esc(c.mermaid)}</pre></div>
    </figure>
    <figure class="panel">
      <figcaption>Trace</figcaption>
      <div class="canvas tr dgw" data-case="${i}"><div class="wait">Drawing…</div></div>
    </figure>
  </div>
  <div class="notes">
    <p><b>What Trace uses.</b> ${esc(c.uses)}</p>
    <p><b>Still missing.</b> ${esc(c.gap)}</p>
  </div>
  <details class="src">
    <summary>Both sources</summary>
    <div class="src-grid">
      <div><h3>Mermaid</h3><pre>${esc(c.mermaid)}</pre></div>
      <div><h3>Trace</h3><pre>${esc(c.trace)}</pre></div>
    </div>
  </details>
</section>`).join('');
let page = fs.readFileSync(path.join(root, 'playground/compare-template.html'), 'utf8');
page = page
  .replace('@@NAV@@', () => nav)
  .replace('@@CARDS@@', () => cards)
  .replace('/*CORE*/', () => fs.readFileSync(path.join(root, 'src/trace.js'), 'utf8'))
  .replace('/*CASES*/', () => 'const CASES = ' + JSON.stringify(cases).replace(/</g, '\\u003c') + ';');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/compare.html'), page);
console.log('dist/compare.html', page.length, 'bytes');
