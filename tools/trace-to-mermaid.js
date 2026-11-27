#!/usr/bin/env node
// Writes a Trace diagram as a Mermaid flowchart, plainly: the same nodes (name and note), zones as subgraphs,
// links with their labels, dashed links dashed. Icons, logos and layout hints have no Mermaid form and are left out.
// Used for the held-out diagrams written for Trace: their .mmd is generated, so both sides draw the same model.
//
//   node tools/trace-to-mermaid.js <file.trace>     prints the flowchart
const fs = require('fs');
const { parse } = require('../src/trace.js');

const esc = t => String(t).replace(/"/g, '#quot;');
const text = n => esc(n.name || n.id) + (n.note ? '<br/>' + esc(n.note) : '');
// the Mermaid shape closest to each kind
const shape = (n) => {
  const t = text(n);
  switch (n.kind) {
    case 'store': return `[("${t}")]`;
    case 'pill': return `(["${t}"])`;
    case 'engine': return `[["${t}"]]`;
    case 'ask': return `{"${t}"}`;
    case 'state': return `("${t}")`;
    default: return `["${t}"]`;
  }
};
const mid = id => id.replace(/[^A-Za-z0-9_]/g, '_');

function convert(src, name) {
  const m = parse(src);
  if (m.errors.length) throw new Error(`${name}: line ${m.errors[0].line}: ${m.errors[0].msg}`);
  const out = [`%% Written for comparison from the same nodes and links as ${name}`, `flowchart ${m.direction === 'DOWN' ? 'TD' : 'LR'}`];
  const write = (c, ind) => {
    for (const it of c.items || []) {
      if (it.type === 'node') out.push(`${ind}${mid(it.id)}${shape(it)}`);
      else if (it.type === 'frame') { out.push(`${ind}subgraph ${mid(it.id)}["${esc(it.title || ' ')}"]`); write(it, ind + '  '); out.push(`${ind}end`); }
      else if (it.items) write(it, ind);       // rows, columns and other blocks: their members, in place
    }
  };
  write(m.root, '  ');
  for (const e of m.edges) {
    if (e.trunk) continue;
    const arrow = e.start && e.end ? (e.dashed ? '<-.->' : '<-->') : e.start || e.end ? (e.dashed ? '-.->' : '-->') : (e.dashed ? '-.-' : '---');
    // a link written a <- b is drawn from b to a
    const [a, b] = e.start && !e.end ? [e.b, e.a] : [e.a, e.b];
    out.push(`  ${mid(a)} ${arrow}${e.label ? `|"${esc(e.label.replace(/\n/g, ' '))}"|` : ''} ${mid(b)}`);
  }
  return out.join('\n') + '\n';
}

module.exports = { convert };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node tools/trace-to-mermaid.js <file.trace>'); process.exit(2); }
  process.stdout.write(convert(fs.readFileSync(file, 'utf8'), require('path').basename(file)));
}
