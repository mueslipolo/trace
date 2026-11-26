#!/usr/bin/env node
// Converts a Mermaid diagram to Trace, plainly: the nodes, links, labels and subgraphs, with no layout help.
// It is how the held-out set is made from real Mermaid diagrams, so the Trace side of a comparison is what a
// user would get from the same content, not a version tuned for the engine.
//
//   node tools/mermaid-to-trace.js diagram.mmd [title]      prints the Trace source
//
// Handles flowchart / graph (shapes, ---, -->, -.->, ==>, <-->, labels in both forms, chains, &, subgraphs,
// :::classes), sequenceDiagram (participants, ->> -->> -> -->, notes) and architecture-beta (groups, services,
// edges). Styling (classDef, class, style, linkStyle, init blocks, comments) is dropped.
const fs = require('fs');

const clean = t => String(t || '').replace(/^["']|["']$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
// a node label: the first line break separates the name from the note under it
const nodeLabel = t => { const [name, ...note] = String(t || '').replace(/^["']|["']$/g, '').split(/<br\s*\/?>/i); return clean(name) + (note.length ? ' | ' + clean(note.join(' ')) : ''); };
const idOf = raw => raw.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9_]/, 'n');

function flowchart(lines, title) {
  const out = [];
  const nodes = new Map();          // id -> { label, kind, parent }
  const edges = [];
  const stack = [{ id: null, title: '', items: [], kids: [] }];
  const frames = [];
  let dir = 'down';
  const hidden = new Set();
  // a node reference with an optional shape: id, id[..], id(..), id([..]), id[(..)], id((..)), id{..}, id{{..}}, id[[..]], id[/../], id>..]
  // an id may hold - and . but not end with them, so a-->b reads as a, -->, b
  const SHAPE = /^([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(\(\[(.*?)\]\)|\[\((.*?)\)\]|\(\((.*?)\)\)|\{\{(.*?)\}\}|\[\[(.*?)\]\]|\[\/(.*?)\/\]|\[\\(.*?)\\\]|\["(.*?)"\]|\("(.*?)"\)|\[(.*?)\]|\((.*?)\)|\{(.*?)\}|>(.*?)\])?(:::[\w-]+)?/;
  const node = (txt, here) => {
    const m = SHAPE.exec(txt.trim());
    if (!m) return null;
    const id = idOf(m[1]);
    let kind = '', label = null;
    if (m[2]) {
      if (m[3] !== undefined) { kind = 'pill'; label = m[3]; }
      else if (m[4] !== undefined) { kind = 'store'; label = m[4]; }
      else if (m[5] !== undefined) { kind = 'pill'; label = m[5]; }
      else if (m[6] !== undefined) { kind = 'engine'; label = m[6]; }
      else if (m[7] !== undefined) label = m[7];
      else if (m[8] !== undefined) label = m[8];
      else if (m[9] !== undefined) label = m[9];
      else if (m[10] !== undefined) label = m[10];
      else if (m[11] !== undefined) label = m[11];
      else if (m[12] !== undefined) label = m[12];
      else if (m[13] !== undefined) label = m[13];
      else if (m[14] !== undefined) { kind = 'ask'; label = m[14]; }
      else if (m[15] !== undefined) label = m[15];
    }
    let n = nodes.get(id);
    if (!n) { n = { id, label: nodeLabel(label || m[1]), kind, parent: here }; nodes.set(id, n); here.items.push(n); }
    else {
      if (label !== null) { n.label = nodeLabel(label); if (kind) n.kind = kind; }
      // as in Mermaid, a node belongs to the innermost subgraph that mentions it: one mentioned first in an outer
      // subgraph (or at the top) moves into a subgraph nested in it
      const inside = (c, f) => { for (let p = c.parent; p; p = p.parent) if (p === f) return true; return false; };
      if (here !== n.parent && inside(here, n.parent)) { n.parent.items.splice(n.parent.items.indexOf(n), 1); here.items.push(n); n.parent = here; }
    }
    return { id, rest: txt.trim().slice(m[0].length) };
  };
  const EDGE = /^\s*(<?)(--|-\.|==|~~)([-.=>ox]*)(?:\|([^|]*)\|)?/;
  for (let raw of lines) {
    let line = raw.replace(/%%.*$/, '').trim().replace(/;$/, '');
    if (!line) continue;
    let m;
    if ((m = line.match(/^(graph|flowchart)\s*(TD|TB|LR|RL|BT)?/i))) { dir = /LR|RL/i.test(m[2] || '') ? 'right' : 'down'; continue; }
    // a subgraph styled with no fill and no stroke is padding (a Mermaid trick against clashing titles): not a frame
    if ((m = line.match(/^style\s+(\S+)\s+.*stroke:\s*none/))) { hidden.add(idOf(m[1])); continue; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
    if ((m = line.match(/^subgraph\s+(.*)$/))) {
      const t = m[1].trim();
      const mm = t.match(/^([A-Za-z0-9_.-]+)\s*\[(.*)\]$/);
      const f = { id: mm ? idOf(mm[1]) : 'g' + frames.length, title: clean(mm ? mm[2] : t), items: [], kids: [], parent: stack[stack.length - 1] };
      frames.push(f); stack[stack.length - 1].kids.push(f); stack.push(f);
      continue;
    }
    if (line === 'end') { if (stack.length > 1) stack.pop(); continue; }
    const here = stack[stack.length - 1];
    // a chain of nodes and links: a & b --> c -- label --> d
    let rest = line, prev = null;
    while (rest) {
      const group = [];
      for (;;) {
        const n = node(rest, here);
        if (!n) { rest = ''; break; }
        group.push(n.id);
        rest = n.rest.trim();
        if (rest.startsWith('&')) { rest = rest.slice(1).trim(); continue; }
        break;
      }
      if (prev) for (const a of prev.ids) for (const b of group) edges.push({ a, b, ...prev.link });
      if (!rest) break;
      // a link: optional text between the dashes (-- text -->) or after (-->|text|)
      let label = '', em;
      const inl = rest.match(/^(<?)(--|-\.|==)\s+(.+?)\s+(-->|---|-\.->|\.->|==>|===|--x|--o)/);
      if (inl) { em = inl; label = inl[3]; rest = rest.slice(inl[0].length).trim(); }
      else if ((em = rest.match(/^(<?)(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|--x|--o|~~~)(\s*\|([^|]*)\|)?/))) { label = em[4] || ''; rest = rest.slice(em[0].length).trim(); }
      else break;
      const op = inl ? inl[1] + inl[2] + inl[4] : em[1] + em[2];
      prev = { ids: group, link: { label: clean(label), dashed: /\./.test(op), both: op.startsWith('<'), arrow: />/.test(op), invisible: /~~~/.test(op) } };
    }
  }
  if (title) out.push(`title "${title}"`);
  if (dir === 'down') out.push('direction down');
  out.push('');
  const decl = n => `${n.kind ? n.kind + ' ' : ''}${n.id}: ${n.label}`;
  const write = (c, ind) => {
    for (const n of c.items) out.push(ind + decl(n));
    for (const f of c.kids) {
      if (hidden.has(f.id)) { write(f, ind); continue; }
      out.push(`${ind}frame ${f.id} "${f.title}" {`); write(f, ind + '  '); out.push(ind + '}');
    }
  };
  write(stack[0], '');
  // a subgraph with nothing declared in it would be an empty frame: Trace needs one statement
  out.push('');
  for (const e of edges) {
    if (e.invisible) continue;
    const op = e.both ? '<->' : !e.arrow ? '--' : e.dashed ? '-->' : '->';
    out.push(`${e.a} ${op} ${e.b}${e.label ? ' : ' + e.label : ''}`);
  }
  return out.join('\n').replace(/frame (\S+) "([^"]*)" \{\n(\s*)\}/g, 'frame $1 "$2" {\n$3  $1_empty: $2\n$3}') + '\n';
}

function sequence(lines, title) {
  const out = ['sequence'];
  if (title) out.push(`title "${title}"`);
  const ids = new Map();
  const id = name => { const t = name.trim(); if (!ids.has(t)) { ids.set(t, idOf(t.replace(/\s+/g, '_')).toLowerCase()); } return ids.get(t); };
  const body = [];
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trim();
    let m;
    if (!line || /^sequenceDiagram/.test(line) || /^(autonumber|activate|deactivate)\b/.test(line)) continue;
    if ((m = line.match(/^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/))) { const i = id(m[2]); out.push(`${m[1] === 'actor' ? 'pill ' : ''}${i}: ${clean(m[3] || m[2])}`); continue; }
    if ((m = line.match(/^Note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i))) { body.push(`note ${m[1].toLowerCase()} ${m[2].split(',').map(id).join(', ')} : ${clean(m[3])}`); continue; }
    if ((m = line.match(/^(.+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)(.+?)\s*:\s*(.*)$/))) {
      body.push(`${id(m[1])} ${m[2].startsWith('--') ? '-->' : '->'} ${id(m[4])} : ${clean(m[5])}`);
      continue;
    }
    if ((m = line.match(/^(loop|alt|opt|par)\s*(.*)$/))) { body.push(`${m[1]} "${clean(m[2])}" {`); continue; }
    if ((m = line.match(/^(else|and)\s*(.*)$/))) { body.push(`${m[1]} "${clean(m[2])}"`); continue; }
    if (line === 'end') { body.push('}'); continue; }
  }
  for (const [name, i] of ids) if (!out.some(l => l.startsWith(i + ':') || l.startsWith('pill ' + i + ':'))) out.push(`${i}: ${clean(name)}`);
  return [...out, '', ...body].join('\n') + '\n';
}

function architecture(lines, title) {
  const ICON = { database: ['store ', 'database'], server: ['', 'server'], disk: ['store ', 'hard-drive'], cloud: ['', 'cloud'], internet: ['', 'globe'] };
  const out = [];
  if (title) out.push(`title "${title}"`);
  const groups = new Map(), roots = [], edges = [];
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trim();
    let m;
    if ((m = line.match(/^group\s+([\w-]+)\(([^)]*)\)\[([^\]]*)\](?:\s+in\s+([\w-]+))?/))) { groups.set(m[1], { id: idOf(m[1]), title: m[3], items: [], parent: m[4] || null }); continue; }
    if ((m = line.match(/^service\s+([\w-]+)\(([^)]*)\)\[([^\]]*)\](?:\s+in\s+([\w-]+))?/))) {
      const [kind, icon] = ICON[m[2]] || ['', ''];
      const decl = `${kind}${idOf(m[1])}${icon ? ` [${icon}]` : ''}: ${m[3]}`;
      (m[4] && groups.has(m[4]) ? groups.get(m[4]).items : roots).push(decl);
      continue;
    }
    if ((m = line.match(/^([\w-]+)(?:\{group\})?:[LRTB]\s*(<?)(--|-->)(>?)\s*[LRTB]:([\w-]+)/))) edges.push(`${idOf(m[1])} ${m[2] ? '<->' : m[3] === '-->' || m[4] ? '->' : '--'} ${idOf(m[5])}`);
  }
  out.push('', ...roots);
  const write = (g, ind) => { out.push(`${ind}frame ${g.id} "${g.title}" {`); for (const d of g.items) out.push(ind + '  ' + d); for (const k of groups.values()) if (k.parent === [...groups.entries()].find(([, v]) => v === g)[0]) write(k, ind + '  '); out.push(ind + '}'); };
  for (const g of groups.values()) if (!g.parent) write(g, '');
  return [...out, '', ...edges].join('\n') + '\n';
}

function convert(src, title) {
  const lines = src.replace(/%%\{.*?\}%%/gs, '').split('\n');
  const first = lines.map(l => l.trim()).find(l => l && !l.startsWith('%%')) || '';
  if (/^sequenceDiagram/.test(first)) return sequence(lines, title);
  if (/^architecture-beta/.test(first)) return architecture(lines, title);
  return flowchart(lines, title);
}

module.exports = { convert };
if (require.main === module) {
  const [file, title] = process.argv.slice(2);
  process.stdout.write(convert(fs.readFileSync(file, 'utf8'), title));
}
