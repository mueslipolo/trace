#!/usr/bin/env node
// Builds dist/playground.html: the template with src/trace.js and the playground examples inlined.
// The page loads elkjs 0.9.3 from jsDelivr and Inter from Google Fonts.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const core = ['lucide-core', 'lucide-names', 'logo-core', 'logo-names', 'trace'].map(n => fs.readFileSync(path.join(root, 'src', n + '.js'), 'utf8')).join('\n');
const order = ['components-and-data-flow', 'job-states', 'routing-and-fallback', 'engines-behind-one-contract',
  'network-boundaries', 'the-vocabulary', 'who-may-delete-audit-rows', 'job-sequence', 'idempotency', 'data-model'];
const dir = path.join(root, 'examples/playground');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.trace')).map(f => f.replace(/\.trace$/, ''));
files.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
const examples = files.map(name => {
  const src = fs.readFileSync(path.join(dir, name + '.trace'), 'utf8');
  const t = /^title\s+"([^"]+)"/m.exec(src);
  return { name: t ? t[1] : name, src };
});
const js = 'const EXAMPLES = ' + JSON.stringify(examples).replace(/</g, '\\u003c') + ';';
let page = fs.readFileSync(path.join(root, 'playground/template.html'), 'utf8');
page = page.replace('/*CORE*/', () => core).replace('/*EXAMPLES*/', () => js);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/playground.html'), page);
console.log('dist/playground.html', page.length, 'bytes');
