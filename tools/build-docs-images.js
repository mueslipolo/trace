#!/usr/bin/env node
// Draws the pictures in README.md and docs/manual.md into docs/images/, as PNGs with the Inter font.
// The README pictures also get a dark version (<name>.dark.png) for a <picture> element; the guide's
// before/after pairs come from examples/features (the "before" with the tidy-ups its feature switches off).
// Run it after a layout change: npm run build:docs
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('./measure.js');
const { toPng, available } = require('./png.js');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs/images');

// README: [name, source]
const readme = [
  ['everything', 'examples/playground/everything.trace'],
  ['dmz', 'examples/cases/dmz.trace'],
  ['bigbank-plain', 'examples/holdout/bigbank-container.trace'],
  ['bigbank-full', 'examples/holdout/full/bigbank-container.trace'],
  ['cicd', 'examples/cases/cicd.trace'],
  ['hybrid', 'examples/cases/hybrid.trace'],
  ['payment', 'examples/cases/payment.trace'],
  ['shop-model', 'examples/cases/shop-model.trace'],
  ['job-sequence', 'examples/playground/job-sequence.trace'],
  ['orgchart', 'examples/cases/orgchart.trace'],
  ['bridge.before', 'examples/features/bridge.before.trace'],
  ['bridge.after', 'examples/features/bridge.after.trace'],
];
// the manual's part 2: feature pairs, before and after; a name ending in ! has its "after" only
const guidePairs = ['direction', 'across', 'lanes', 'bridge', 'span', 'side', 'samewidth!', 'align!', 'bus!', 'join!'];
const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/features/features.json'), 'utf8'));
// [name, source, tidy-ups off]
const guide = [];
for (const g of guidePairs) {
  const id = g.replace(/!$/, ''), m = meta.find(f => f.id === id);
  if (!m) throw new Error(`no feature ${id} in examples/features/features.json`);
  for (const k of g.endsWith('!') ? ['after'] : ['before', 'after'])
    if (!readme.some(r => r[0] === `${id}.${k}`)) guide.push([`${id}.${k}`, `examples/features/${id}.${k}.trace`, k === 'before' ? m.beforeOff || [] : []]);
}

async function draw(name, file, off = [], theme) {
  const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, { off });
  if (res.errors.length) throw new Error(`${file}:${res.errors[0].line}: ${res.errors[0].msg}`);
  const png = toPng(res.standalone(theme), { zoom: 1.5, dark: theme === 'dark' });
  fs.writeFileSync(path.join(outDir, `${name}${theme === 'dark' ? '.dark' : ''}.png`), png);
}

(async () => {
  if (!available()) { console.error('Needs @resvg/resvg-js: run npm install'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, file] of readme) { await draw(name, file, [], 'light'); await draw(name, file, [], 'dark'); }
  for (const [name, file, off] of guide) await draw(name, file, off, 'light');
  console.log(`docs/images: ${readme.length * 2 + guide.length} pictures`);
})().catch(e => { console.error(e.message); process.exit(1); });
