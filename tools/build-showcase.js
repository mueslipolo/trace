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
const LABELS = { icons: ['icon', 'icons'], span: ['span node', 'span nodes'], bridge: ['bridge', 'bridges'], join: ['join', 'joins'], top: ['icon on top', 'icons on top'], blocks: ['row or column', 'rows and columns'], rails: ['rail', 'rails'], sizing: ['same-width line', 'same-width lines'], reversed: ['reversed link', 'reversed links'], side: ['side zone', 'side zones'], marks: ['mark', 'marks'] };
const adds = st => Object.entries(st).filter(([, v]) => v).map(([k, v]) => `${v} ${LABELS[k][v === 1 ? 0 : 1]}`).join(', ') || 'nothing: this diagram is already fine on its own';
// the page shows one case at a time: a list of cases on the left (a menu on a phone), the case on the right
const md = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
const nav = cases.map((c, i) => `<li><a href="#${c.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.title)}</span></a></li>`).join('');
const options = cases.map((c, i) => `<option value="${c.id}">${String(i + 1).padStart(2, '0')} ${esc(c.title)}</option>`).join('');
for (const c of cases) { c.addsText = esc(adds(c.stats)); c.usesHtml = md(c.uses); c.gapHtml = md(c.gap); }
let page = fs.readFileSync(path.join(root, 'playground/showcase-template.html'), 'utf8');
page = page
  .replace('@@NAV@@', () => nav)
  .replace('@@OPTIONS@@', () => options)
  .replace('/*CORE*/', () => ['lucide-core', 'lucide-names', 'logo-core', 'logo-names', 'trace'].map(n => fs.readFileSync(path.join(root, 'src', n + '.js'), 'utf8')).join('\n'))
  .replace('/*CASES*/', () => 'const CASES = ' + JSON.stringify(cases).replace(/</g, '\\u003c') + ';');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/showcase.html'), page);
console.log('dist/showcase.html', page.length, 'bytes');
