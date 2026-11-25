#!/usr/bin/env node
// Turns a "full" diagram into its "simple" form: the same nodes, links, labels and frames, written the
// way you would without any layout help. It removes
//   - icons and the tags span, bridge and top,
//   - rows and columns (the members become plain nodes in their frame),
//   - same-width and same-height lines,
//   - side and span on frames (side zones go back to being the next tier),
//   - rails (the nodes in the rail become plain nodes; links to the rail go to its first node),
//   - the reversed links <- and <-- (written the natural way round, source first),
//   - mark lines (the links they hid are drawn again).
// Usage: node tools/simplify.js          writes examples/cases/simple/*.trace from examples/cases/*.trace
const fs = require('fs');
const path = require('path');
const { parse } = require('../src/trace.js');

const KEEP = new Set(['ok', 'bad', 'dashed', 'muted']);

function simplify(src) {
  const stats = { icons: 0, span: 0, bridge: 0, top: 0, blocks: 0, rails: 0, reversed: 0, sizing: 0, marks: 0 };
  const rails = new Map();   // rail id -> its first node
  let curRail = null;
  const out = [];
  const stack = [];
  let depth = 0;
  const emit = line => { if (line.trim() || (out.length && out[out.length - 1].trim())) out.push(line); };
  for (const raw of src.split('\n')) {
    const t = raw.trim();
    if (!t) { emit(''); continue; }
    if (t === '}') {
      const kind = stack.pop();
      if (kind === 'frame') { depth--; emit('  '.repeat(depth) + '}'); }
      else if (kind === 'rail') { curRail = null; stats.rails++; }
      else stats.blocks++;
      continue;
    }
    if (t.endsWith('{')) {
      const m = t.match(/^(frame|column|row|rail)\b/i);
      const kind = m ? m[1].toLowerCase() : 'frame';
      stack.push(kind);
      if (kind === 'rail') { curRail = { id: t.split(/\s+/)[1], first: null }; rails.set(curRail.id, curRail); }
      if (kind === 'frame') { emit('  '.repeat(depth) + t.replace(/\[([^\]]*)\]/, (m, tags) => { const k = tags.split(/[\s,]+/).filter(w => w && !/^(side|span|left|right|top|bottom)$/.test(w)); if (k.length !== tags.split(/[\s,]+/).filter(Boolean).length) stats.side = (stats.side || 0) + 1; return k.length ? '[' + k.join(' ') + ']' : ''; }).replace(/\s+\{$/, ' {')); depth++; }
      continue;
    }
    if (/^same-(width|height)\b/i.test(t)) { stats.sizing++; continue; }
    if (/^mark\s+[A-Za-z0-9_][\w.-]*\s*(\[|"|:|$)/i.test(t)) { stats.marks++; continue; }
    // a node line: tags in the brackets before the colon
    const nm = raw.match(/^\s*((?:store |engine |state |pill |ask |final |box )?[A-Za-z0-9_][\w.-]*)(\s*\[([^\]]*)\])?(\s*:.*)$/);
    if (nm && !/(->|<-|--)/.test(raw.slice(0, raw.indexOf(':') < 0 ? raw.length : raw.indexOf(':'))) && !/^\s*(title|direction|spacing|key)\b/.test(raw)) {
      const tags = nm[3] ? nm[3].trim().split(/[\s,]+/).filter(Boolean) : [];
      const keep = [];
      for (const g of tags) {
        if (KEEP.has(g)) keep.push(g);
        else if (g === 'span' || g === 'bridge' || g === 'top') stats[g]++;
        else stats.icons++;
      }
      if (curRail && !curRail.first) curRail.first = nm[1].trim().split(/\s+/).pop();
      emit('  '.repeat(depth) + nm[1] + (keep.length ? ` [${keep.join(' ')}]` : '') + nm[4]);
      continue;
    }
    // a single reversed link: x <- y  becomes  y -> x
    const rm = raw.match(/^\s*([A-Za-z0-9_][\w.-]*)\s*(<--|<-)\s*([A-Za-z0-9_][\w.-]*)(.*)$/);
    if (rm && !/(->|-->|<->|<--|<-|--)/.test(rm[4].split(':')[0])) {
      stats.reversed++;
      emit('  '.repeat(depth) + `${rm[3]} ${rm[2] === '<--' ? '-->' : '->'} ${rm[1]}${rm[4]}`);
      continue;
    }
    emit('  '.repeat(depth) + t);
  }
  // links to a rail go to the first node in it
  for (const [id, r] of rails) {
    if (!r.first) continue;
    const re = new RegExp('(^|\\s)' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'g');
    for (let i = 0; i < out.length; i++) if (/(->|-->|<->|--)/.test(out[i].split(':')[0])) out[i] = out[i].replace(re, `$1${r.first}`);
  }
  // a legend entry about borders belongs to bridges, which are gone
  if (stats.bridge) for (let i = out.length - 1; i >= 0; i--) if (/^\s*key\b.*\bborder\b/.test(out[i])) out.splice(i, 1);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.join('\n') + '\n', stats };
}

module.exports = { simplify };

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'examples', 'cases');
  fs.mkdirSync(path.join(dir, 'simple'), { recursive: true });
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.trace'))) {
    const { text, stats } = simplify(fs.readFileSync(path.join(dir, f), 'utf8'));
    const errs = parse(text).errors;
    if (errs.length) { console.error(`${f}: the simple form does not parse: ${errs[0].line}: ${errs[0].msg}`); process.exit(1); }
    fs.writeFileSync(path.join(dir, 'simple', f), text);
    console.log(f.padEnd(16), Object.entries(stats).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to remove');
  }
}
