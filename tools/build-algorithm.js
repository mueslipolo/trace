#!/usr/bin/env node
// Writes docs/algorithm.md, the visual explanation of the layout, and its pictures in docs/images/algo/.
// The pictures are the engine's own work: each example is laid out with compile(..., { onStage }), the drawing
// is kept after the layout and after every step of the tidy-up, and for each step the example where it changes
// the most legible little is shown before and after, cropped to the change, the change in orange.
// Run by npm run build:docs. Captions are in STEPS below: one line each, no more.
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile, render } = require('../src/trace.js');
const { measure } = require('./measure.js');
const { toPng, available } = require('./png.js');
const { sketch, SKETCHES } = require('./algorithm-sketches.js');

const root = path.join(__dirname, '..');
const imgDir = path.join(root, 'docs/images/algo');
const OUT = path.join(root, 'docs/algorithm.md');

// [step, title, one line]
const STEPS = [
  ['centreParents', 'Parents over their children', 'With `tree`, each parent moves over the middle of its children.'],
  ['placeOnConcentrators', 'Junctions inside zones', 'Five or more alike links from one zone meet one line inside it; each runs straight across to it.'],
  ['splitDecisions', 'Decisions part at the box', "A question's yes and no leave from different sides."],
  ['spanSides', 'Side zones line up', 'A side zone stretches along the zones it serves; its nodes move level with their links.'],
  ['clearFrames', 'Off the borders', 'A link running along a zone border moves off it.'],
  ['alignJogs', 'Steps at one height', 'Links into one node take their step at the same height.'],
  ['simplifySnakes', 'No snakes', 'A link that zigzags more than it needs takes the shorter route.'],
  ['mergeHubs', 'Gathered links', 'Five or more alike links into one node (`gather N` changes the number) become one bus, the label written once.'],
  ['rerouteBlocked', 'Around, never through', 'A link through or along a node, or on top of another link, is routed again on a grid.'],
  ['straightenSmallJogs', 'Small steps removed', 'A step of a few pixels is not worth a bend: the end slides and the link is straight.'],
  ['reorderEnds', 'Ends that do not cross', 'Links leaving one side of a node take the order that crosses least.'],
  ['spreadEnds', 'Arrowheads apart', 'Ends on one side of a node are pushed apart, in the order their links go.'],
  ['separateParallels', 'Parallel links apart', 'Two links running side by side too close are pulled apart.'],
  ['uncrossSteps', 'Steps swapped', 'Two links that cross twice swap their steps and cross no more.'],
  ['resolveOverlaps', 'Nothing on top', 'Links still lying on top of each other are separated.'],
  ['slideToStraighten', 'Nodes slide to their links', 'A node whose links all arrive with a short step slides so they arrive straight.'],
  ['rerouteSiblings', 'A second look', 'A link crossing a sibling of its own node is routed again, kept only if it crosses less.'],
  ['squareUp', 'Square', 'Every stretch is made exactly horizontal or vertical.'],
  ['placeLabels', 'Labels placed', 'Each label goes beside its link where it covers nothing.'],
  ['roomForTitles', 'Room for titles', 'A zone with no free corner grows a band for its title.'],
  ['alignTitleEdges', 'Titles in line', 'Zones side by side put their titles on the same edge.'],
  ['sameSizeFrames', 'Same size', 'Zones written `same-width` or `same-height` grow to one size.'],
  ['fitCanvas', 'Cut to size', 'The drawing is cut to what it holds, with a margin.'],
];

// the diagrams the steps are taken from
const POOL = [
  ...['cases', 'cases/simple', 'playground', 'holdout'].flatMap(d => fs.readdirSync(path.join(root, 'examples', d))
    .filter(f => f.endsWith('.trace')).map(f => `examples/${d}/${f}`)),
];
const OVERVIEW = 'examples/cases/simple/cqrs.trace';

const ORANGE = '#f08c00';
const near = (a, b) => Math.abs(a - b) < 0.5;

async function stagesOf(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const runs = new Map();
  const res = await compile(src, measure, ELK, { onStage: (name, rm) => {
    if (!runs.has(rm)) runs.set(rm, []);
    runs.get(rm).push({ name, rm: structuredClone(rm) });
  } });
  if (res.errors.length || !res.rm) return null;
  // the title block is measured after the layout: every stage gets the finished one, so all are drawn alike
  for (const st of runs.get(res.rm) || []) st.rm.head = structuredClone(res.rm.head);
  return { file, src, title: (res.rm.model && res.rm.model.title) || path.basename(file, '.trace'), stages: runs.get(res.rm) || [] };
}

// how far a polyline moved: the largest distance from a point of one to the other line
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function lineDist(P, Q) {
  const one = (A, B) => Math.max(...A.map(p => Math.min(...B.slice(1).map((q, i) => segDist(p, B[i], q)), B.length === 1 ? Math.hypot(p.x - B[0].x, p.y - B[0].y) : Infinity)));
  return Math.max(one(P, Q), one(Q, P));
}

// what changed between two drawings: boxes (in the drawing's coordinates) and the changed links and nodes
function changes(a, b) {
  const boxes = [], hi = { edges: [], nodes: [], labs: [] };
  let move = 0;      // how far the most moved thing moved, in pixels: what the eye sees
  const nb = n => ({ x: n.x, y: n.y, w: n.w, h: n.h });
  const bOf = pts => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  for (const n of b.nodes) {
    const o = a.nodes.find(m => m.id === n.id);
    if (n.x === undefined || !o || o.x === undefined) continue;
    if (!near(o.x, n.x) || !near(o.y, n.y) || !near(o.w, n.w) || !near(o.h, n.h)) { boxes.push(nb(o), nb(n)); hi.nodes.push(nb(n)); move = Math.max(move, Math.abs(o.x - n.x), Math.abs(o.y - n.y), Math.abs(o.w - n.w), Math.abs(o.h - n.h)); }
  }
  b.edges.forEach((r, i) => {
    const o = a.edges[i];
    if (!o || !r.pts || !o.pts || r.e.lifeline || r.e.rail) return;
    const same = o.pts.length === r.pts.length && o.pts.every((p, k) => near(p.x, r.pts[k].x) && near(p.y, r.pts[k].y));
    if (!same) {
      boxes.push(bOf(o.pts), bOf(r.pts)); hi.edges.push(r.pts); move = Math.max(move, lineDist(o.pts, r.pts));
      // the whole nodes at both ends, so nothing is cut in half at the picture's edge
      for (const id of [r.e.a, r.e.b]) { const n = b.nodes.find(m => m.id === id); if (n && n.x !== undefined) boxes.push(nb(n)); }
    }
    if (r.lab && r.e.lab && (!o.lab || !near(o.lab.x, r.lab.x) || !near(o.lab.y, r.lab.y))) {
      const w = r.e.lab.w, x0 = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x;
      const lb = { x: x0, y: r.lab.y, w, h: r.e.lab.h };
      boxes.push(lb); hi.labs.push(lb); move = Math.max(move, o.lab ? Math.hypot(o.lab.x - r.lab.x, o.lab.y - r.lab.y) : 20);
    }
  });
  b.frames.forEach((f, i) => {
    const o = a.frames[i];
    if (o && (!near(o.x, f.x) || !near(o.y, f.y) || !near(o.w, f.w) || !near(o.h, f.h))) { boxes.push(nb(o), nb(f)); hi.nodes.push(nb(f)); move = Math.max(move, Math.abs(o.x - f.x), Math.abs(o.y - f.y), Math.abs(o.w - f.w), Math.abs(o.h - f.h)); }
  });
  const size = !near(a.width, b.width) || !near(a.height, b.height);
  return { boxes, hi, size, move, count: hi.edges.length + hi.nodes.length + hi.labs.length };
}

// the drawing's SVG, the content shifted by the title (a <g transform="translate(0,N)">)
function svgOf(rm) {
  const svg = render(structuredClone(rm), { standalone: true, theme: 'light' });
  const m = svg.match(/<g transform="translate\(0,([\d.]+)\)">/);
  return { svg, dy: m ? parseFloat(m[1]) : 0 };
}

function crop(svg, box, dy = 0) {
  // links wholly outside the crop are left out: they cannot be seen, and resvg fails on an arrowhead outside the
  // view box
  svg = svg.replace(/<path class="arrow[^"]*" d="([^"]*)"[^>]*\/>/g, (m, d) => {
    const n = (d.match(/-?[\d.]+/g) || []).map(Number), xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2).map(y => y + dy);
    const out = Math.max(...xs) < box.x || Math.min(...xs) > box.x + box.w || Math.max(...ys) < box.y || Math.min(...ys) > box.y + box.h;
    return out ? '' : m;
  });
  return svg.replace(/viewBox="[^"]*"/, `viewBox="${box.x} ${box.y} ${box.w} ${box.h}"`)
    .replace(/^(<svg[^>]*?) width="[\d.]+"/, `$1 width="${box.w}"`).replace(/^(<svg[^>]*?) height="[\d.]+"/, `$1 height="${box.h}"`);
}

function highlight(svg, dy, hi) {
  const r1 = v => Math.round(v * 10) / 10;
  const parts = [];
  for (const pts of hi.edges) parts.push(`<path d="M${pts.map(p => `${r1(p.x)} ${r1(p.y)}`).join(' L')}" fill="none" stroke="${ORANGE}" stroke-width="6" stroke-opacity="0.35" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const b of hi.nodes) parts.push(`<rect x="${r1(b.x - 4)}" y="${r1(b.y - 4)}" width="${r1(b.w + 8)}" height="${r1(b.h + 8)}" rx="9" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`);
  for (const b of hi.labs) parts.push(`<rect x="${r1(b.x - 3)}" y="${r1(b.y - 2)}" width="${r1(b.w + 6)}" height="${r1(b.h + 4)}" rx="4" fill="${ORANGE}" fill-opacity="0.18" stroke="${ORANGE}" stroke-width="1.5"/>`);
  return svg.replace(/<\/svg>\s*$/, `<g transform="translate(0,${dy})">${parts.join('')}</g></svg>`);
}

function cropBox(boxes, rm, dy) {
  const M = 28;
  let x0 = Math.min(...boxes.map(b => b.x)) - M, y0 = Math.min(...boxes.map(b => b.y)) - M;
  let x1 = Math.max(...boxes.map(b => b.x + b.w)) + M, y1 = Math.max(...boxes.map(b => b.y + b.h)) + M;
  const grow = (lo, hi, min) => { const d = Math.max(0, min - (hi - lo)) / 2; return [lo - d, hi + d]; };
  [x0, x1] = grow(x0, x1, 340); [y0, y1] = grow(y0, y1, 190);
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(rm.width, x1); y1 = Math.min(rm.height, y1);
  const box = { x: Math.round(x0), y: Math.round(y0 + dy), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  // a change outside the drawing (it was cut smaller) or with no size: show the whole drawing
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 40 || box.h < 40) return { x: 0, y: 0, w: Math.ceil(rm.width), h: Math.ceil(rm.height + dy) };
  return box;
}

// an ELK phase on a tiny graph, drawn by hand: nodes as rounded boxes with a letter, links as arrows
function elkPanel(nodes, links, { w = 300, h = 170, dashed = [], cross = [] } = {}) {
  const ink = '#1d2330', soft = '#9aa3b2';
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${ink}"/></marker></defs>`];
  links.forEach(([pts, opts = {}], i) => {
    const d = 'M' + pts.map(p => p.join(' ')).join(' L');
    out.push(`<path d="${d}" fill="none" stroke="${opts.orange ? ORANGE : ink}" stroke-width="${opts.orange ? 2.2 : 1.3}"${opts.dashed ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#a)"/>`);
  });
  for (const [x, y] of cross) out.push(`<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${ORANGE}" stroke-width="2.2"/>`);
  for (const [id, x, y, opts = {}] of nodes) {
    out.push(`<rect x="${x - 20}" y="${y - 14}" width="40" height="28" rx="7" fill="#fff" stroke="${opts.orange ? ORANGE : ink}" stroke-width="${opts.orange ? 2.2 : 1.3}"/>`);
    out.push(`<text x="${x}" y="${y + 5}" text-anchor="middle" style="font-family:Inter;font-size:13px;font-weight:600" fill="${ink}">${id}</text>`);
  }
  for (const [x, y0, y1] of dashed) out.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${soft}" stroke-dasharray="3 4"/>`);
  out.push('</svg>');
  return out.join('');
}

const ELK_PHASES = [
  ['Cycles broken', 'A link that closes a loop is turned round for the layout (its arrow is kept).',
    elkPanel([['A', 50, 85], ['B', 150, 50], ['C', 250, 85], ['D', 150, 125]],
      [[[[70, 80], [130, 55]]], [[[170, 55], [230, 80]]], [[[230, 92], [170, 120]]], [[[130, 120], [70, 92]], { orange: true }]])],
  ['Layers', 'Every node gets a column, in the order of the flow.',
    elkPanel([['A', 50, 85], ['B', 150, 50], ['D', 150, 125], ['C', 250, 85]],
      [[[[70, 80], [130, 55]]], [[[70, 90], [130, 120]]], [[[170, 55], [230, 80]]], [[[170, 120], [230, 92]]]], { dashed: [[100, 20, 150], [200, 20, 150]] })],
  ['Order in each layer', 'Nodes in one column are reordered until links cross least.',
    elkPanel([['A', 50, 50], ['E', 50, 125], ['B', 150, 50, { orange: true }], ['D', 150, 125, { orange: true }], ['C', 250, 85]],
      [[[[70, 50], [130, 50]]], [[[70, 125], [130, 125]]], [[[170, 55], [230, 80]]], [[[170, 120], [230, 92]]]])],
  ['Positions', 'Nodes are placed so as many links as possible run straight.',
    elkPanel([['A', 50, 60], ['B', 150, 60], ['C', 250, 60], ['D', 150, 125]],
      [[[[70, 60], [130, 60]], { orange: true }], [[[170, 60], [230, 60]], { orange: true }], [[[70, 70], [90, 70], [90, 125], [130, 125]]]])],
  ['Routes', 'Links are drawn with right angles between the nodes.',
    elkPanel([['A', 50, 60], ['B', 150, 60], ['C', 250, 60], ['D', 150, 125]],
      [[[[70, 60], [130, 60]]], [[[170, 60], [230, 60]]], [[[70, 70], [90, 70], [90, 125], [130, 125]], { orange: true }], [[[170, 125], [210, 125], [210, 70], [230, 70]], { orange: true }]])],
];

const png = (svg, zoom = 1.5) => { if (process.env.ALGO_DEBUG) require('fs').writeFileSync(process.env.ALGO_DEBUG, svg); return toPng(svg, { zoom }); };

if (require.main === module) (async () => {
  if (!available()) { console.error('Needs @resvg/resvg-js: run npm install'); process.exit(2); }
  fs.rmSync(imgDir, { recursive: true, force: true });
  fs.mkdirSync(imgDir, { recursive: true });
  const img = (name, buf) => { fs.writeFileSync(path.join(imgDir, name), buf); return `images/algo/${name}`; };

  // every step, on every example: the clearest change wins (few changed parts, a small crop)
  const best = new Map();
  const used = new Map();
  for (const file of POOL) {
    const d = await stagesOf(file);
    if (!d) continue;
    for (let i = 1; i < d.stages.length; i++) {
      const name = d.stages[i].name, a = d.stages[i - 1].rm, b = d.stages[i].rm;
      const c = changes(a, b);
      if (!c.count) continue;
      const area = (() => { const bx = cropBox(c.boxes, b, 0); return bx.w * bx.h; })();
      // what the eye can see first: a move of 8px or more beats any smaller one; among those, a small picture with
      // few changes and a big move
      const visible = c.move >= 8;
      const score = (visible ? 0 : 1e6) + area * (c.count > 5 ? 3 : 1) / 1000 / Math.min(4, c.move / 8 || 0.01);
      const cur = best.get(name);
      if (!cur || score < cur.score) best.set(name, { score, d, i, c });
    }
  }

  const md = [];
  md.push('# How Trace lays out a diagram', '');
  md.push('Pictures first: every picture below is drawn by the engine itself (`npm run build:docs`). In each step, what changed is in orange.', '');

  // overview: the text, ELK's result, the finished drawing
  const ov = await stagesOf(OVERVIEW);
  const elkRm = ov.stages.find(s => s.name === 'layout').rm, endRm = ov.stages[ov.stages.length - 1].rm;
  const a1 = img('overview-elk.png', png(svgOf(elkRm).svg, 1)), a2 = img('overview-end.png', png(svgOf(endRm).svg, 1));
  md.push('## The journey', '');
  md.push('<table>', '<tr><th>1. You write text</th><th>2. ELK places the parts</th><th>3. Trace tidies up</th></tr>', '<tr>');
  md.push('<td valign="top">', '', '```', ov.src.replace(/\s+$/, '').split('\n').slice(0, 14).join('\n') + '\n…', '```', '', '</td>');
  md.push(`<td valign="top"><img src="${a1}" alt="The diagram as ELK leaves it" width="100%"></td>`);
  md.push(`<td valign="top"><img src="${a2}" alt="The finished drawing" width="100%"></td>`, '</tr>', '</table>', '');
  md.push(`<!-- source ${OVERVIEW} "Trace source of this diagram" -->`, '<!-- /source -->', '');

  // inside ELK
  md.push('## Inside ELK', '', 'ELK (the Eclipse Layout Kernel, layered algorithm) does the first placement, in five phases:', '');
  md.push('<table>', '<tr>');
  ELK_PHASES.forEach(([t], k) => md.push(`<th>${k + 1}. ${t}</th>`));
  md.push('</tr>', '<tr>');
  ELK_PHASES.forEach(([t, , svg], k) => md.push(`<td valign="top"><img src="${img(`elk-${k + 1}.png`, png(svg))}" alt="${t}" width="100%"></td>`));
  md.push('</tr>', '<tr>');
  ELK_PHASES.forEach(([, line]) => md.push(`<td valign="top"><sub>${line}</sub></td>`));
  md.push('</tr>', '</table>', '');
  md.push('Before ELK, Trace sets the scene: sizes every node, and turns zones, rows and columns into nested boxes for it.', '');

  // the tidy-up
  md.push("## Trace's tidy-up, step by step", '', 'After ELK, the drawing goes through these steps, in this order. Each step is sketched, then shown in a real diagram drawn by the engine.', '');
  let k = 0;
  for (const [name, title, line] of STEPS) {
    k++;
    md.push(`<!-- step: ${name} -->`);
    md.push(`### ${k}. ${title}`, '', line, '');
    // the idea, drawn small: before and after
    const sk = SKETCHES[name];
    if (sk) {
      md.push('<table>', '<tr><th>Before</th><th>After</th></tr>', '<tr>');
      md.push(`<td valign="top"><img src="${img(`${name}.sketch-before.png`, png(sketch(sk[0])))}" alt="${title}, sketched: before" width="100%"></td>`);
      md.push(`<td valign="top"><img src="${img(`${name}.sketch-after.png`, png(sketch(sk[1])))}" alt="${title}, sketched: after" width="100%"></td>`, '</tr>', '</table>', '');
    }
    const b = best.get(name);
    if (!b || b.c.move < 8) { md.push('<sub>No diagram in `examples/` shows it visibly at the moment.</sub>', ''); continue; }
    const before = b.d.stages[b.i - 1].rm, after = b.d.stages[b.i].rm;
    const sb = svgOf(before), sa = svgOf(after);
    const box = cropBox(b.c.boxes, after, sa.dy);
    const boxB = { ...box, y: box.y - sa.dy + sb.dy };
    const p1 = img(`${name}.before.png`, toPng(sb.svg, { zoom: 1.5, crop: boxB }));
    const p2 = img(`${name}.after.png`, toPng(highlight(sa.svg, sa.dy, b.c.hi), { zoom: 1.5, crop: box }));
    md.push('<details><summary>In a real diagram</summary>', '', '<table>', '<tr><th>Before</th><th>After</th></tr>', '<tr>');
    md.push(`<td valign="top"><img src="${p1}" alt="${title}: before" width="100%"></td>`);
    md.push(`<td valign="top"><img src="${p2}" alt="${title}: after" width="100%"></td>`, '</tr>', '</table>', '');
    const anchor = b.d.file.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    md.push(`<sub>From [${b.d.title}](#${anchor}), the clearest case among the diagrams in \`examples/\`.</sub>`, '', '</details>', '');
    used.set(b.d.file, { title: b.d.title, anchor });
  }

  // the diagrams used, with their sources
  md.push('## The diagrams used', '');
  for (const [file, u] of [...used].sort((x, y) => x[1].title.localeCompare(y[1].title))) {
    md.push(`<a id="${u.anchor}"></a>`, `**${u.title}** (\`${file}\`)`, '', `<!-- source ${file} -->`, '<!-- /source -->', '');
  }
  fs.writeFileSync(OUT, md.join('\n'));
  for (const [n, b] of best) if (b.c.move < 8) console.log(`  ${n}: the largest change is ${b.c.move.toFixed(1)}px (${b.d.file})`);
  console.log(`docs/algorithm.md: ${STEPS.length} steps, ${best.size} with a picture, from ${used.size} diagrams`);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { STEPS };
