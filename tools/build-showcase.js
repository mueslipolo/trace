#!/usr/bin/env node
// Builds dist/showcase.html: every case in examples/cases drawn live in the page from its Trace
// source. Case notes live in examples/cases/cases.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/cases/cases.json'), 'utf8'));
const cases = meta.map(m => ({ ...m, trace: fs.readFileSync(path.join(root, 'examples/cases', m.id + '.trace'), 'utf8') }));
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
      <div class="canvas tr dgw" data-case="${i}"><div class="wait">Drawing…</div></div>
    </figure>
  </div>
  <div class="notes">
    <p><b>What it uses.</b> ${esc(c.uses)}</p>
    <p><b>Still missing.</b> ${esc(c.gap)}</p>
  </div>
  <details class="src">
    <summary>Source</summary>
    <div class="src-grid"><pre>${esc(c.trace)}</pre></div>
  </details>
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
