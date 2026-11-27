#!/usr/bin/env node
// Writes the Trace source of every diagram shown in the docs next to its picture, so a reader can always see
// what was written. In README.md and docs/*.md a pair of markers names the file:
//
//   <!-- source examples/cases/dmz.trace "Trace source" -->
//   <!-- /source -->
//
// and everything between them is replaced by a collapsible block holding that file (the label is optional;
// `open` instead of a label writes the code block without the collapsible). `npm run build:docs` runs it; a test
// fails when a block is out of date.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const MARK = /<!-- source (\S+)(?: (open|"[^"]*"))? -->[\s\S]*?<!-- \/source -->/g;

function fill(md) {
  return md.replace(MARK, (_, file, opt) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\s+$/, '');
    const code = '```\n' + src + '\n```';
    const head = `<!-- source ${file}${opt ? ' ' + opt : ''} -->`;
    if (opt === 'open') return `${head}\n\n${code}\n\n<!-- /source -->`;
    const label = opt ? opt.slice(1, -1) : 'Trace source';
    return `${head}\n<details><summary>${label}</summary>\n\n${code}\n\n</details>\n<!-- /source -->`;
  });
}

function docFiles() {
  return ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];
}

if (require.main === module) {
  let n = 0;
  for (const f of docFiles()) {
    const p = path.join(root, f), md = fs.readFileSync(p, 'utf8'), out = fill(md);
    n += (md.match(MARK) || []).length;
    if (out !== md) fs.writeFileSync(p, out);
  }
  console.log(`doc sources: ${n} blocks`);
}
module.exports = { fill, docFiles };
