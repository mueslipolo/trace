#!/usr/bin/env node
// Builds dist/features.html: every feature of the language drawn without and with it, from the small sources in
// examples/features (<id>.before.trace and <id>.after.trace) and the text in examples/features/features.json.
// A feature can switch an automatic tidy-up off for its "before" (fold, merge, tidy) to show what it does.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/features/features.json'), 'utf8'));
const features = meta.map(m => ({
  ...m,
  before: fs.readFileSync(path.join(root, 'examples/features', m.id + '.before.trace'), 'utf8'),
  after: fs.readFileSync(path.join(root, 'examples/features', m.id + '.after.trace'), 'utf8'),
}));
const nav = features.map(f => `<li><a href="#${f.id}">${esc(f.title)}</a></li>`).join('');
let lastGroup = null;
const cards = features.map((f, i) => {
  const head = f.group !== lastGroup ? `\n<h2 class="group">${esc(f.group)}</h2>` : '';
  lastGroup = f.group;
  const auto = f.group === 'Automatic' ? '<span class="auto">automatic</span>' : '';
  return `${head}
<details class="case" id="${f.id}" open>
  <summary class="case-head">
    <span class="num">${String(i + 1).padStart(2, '0')}</span>
    <h2>${esc(f.title)}</h2>${auto}
    <span class="chev" aria-hidden="true"></span>
  </summary>
  <div class="case-body">
    <p class="does">${md(f.does)}</p>
    <div class="how">
      <div><b>Write</b><pre>${esc(f.syntax)}</pre></div>
      <p><b>Use it when</b>${md(f.use)}</p>
    </div>
    <div class="pair${f.wide ? ' wide' : ''}">
      <figure class="panel">
        <figcaption><b>${esc(f.beforeLabel)}</b></figcaption>
        <div class="canvas tr dgw" data-case="${i}" data-variant="before"><div class="wait">Drawing…</div></div>
        <details class="src"><summary>Source</summary><div class="src-grid"><pre>${esc(f.before)}</pre></div></details>
      </figure>
      <figure class="panel">
        <figcaption><b>${esc(f.afterLabel)}</b></figcaption>
        <div class="canvas tr dgw" data-case="${i}" data-variant="after"><div class="wait">Drawing…</div></div>
        <details class="src"><summary>Source</summary><div class="src-grid"><pre>${esc(f.after)}</pre></div></details>
      </figure>
    </div>
    <p class="change"><b>What changes</b>${md(f.effect)}</p>
  </div>
</details>`;
}).join('');
let page = fs.readFileSync(path.join(root, 'playground/features-template.html'), 'utf8');
page = page
  .replace('@@NAV@@', () => nav)
  .replace('@@CARDS@@', () => cards)
  .replace('/*CORE*/', () => ['lucide-core', 'lucide-names', 'trace'].map(n => fs.readFileSync(path.join(root, 'src', n + '.js'), 'utf8')).join('\n'))
  .replace('/*FEATURES*/', () => 'const FEATURES = ' + JSON.stringify(features).replace(/</g, '\\u003c') + ';');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/features.html'), page);
console.log('dist/features.html', page.length, 'bytes');
