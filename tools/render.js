#!/usr/bin/env node
// Usage: node tools/render.js diagram.trace [out.svg]
// Writes a standalone SVG (light and dark via prefers-color-scheme). Prints problems with line numbers.
const fs = require('fs');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('./measure.js');

(async () => {
  const [inp, out] = process.argv.slice(2);
  if (!inp) { console.error('Usage: node tools/render.js diagram.trace [out.svg]'); process.exit(2); }
  const res = await compile(fs.readFileSync(inp, 'utf8'), measure, ELK, {});
  if (res.errors.length) {
    for (const e of res.errors) console.error(`${inp}:${e.line}: ${e.msg}`);
    process.exit(1);
  }
  if (res.empty) { console.error(`${inp}: nothing to draw`); process.exit(1); }
  const svg = res.standalone();
  if (out) fs.writeFileSync(out, svg); else process.stdout.write(svg);
})();
