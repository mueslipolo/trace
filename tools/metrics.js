#!/usr/bin/env node
// Layout metrics over two sets of diagrams: the examples (showcase cases, their simple forms, the playground),
// which the rules were tuned on, and the held-out set (examples/holdout: real diagrams from public C4 and
// Mermaid sources, adapted to Trace, never tuned on). A rule is generic when it improves the first set without
// making the second worse.
//
//   npm run metrics                       both sets, compared with metrics/baseline.json when it exists
//   npm run metrics -- --save             ... and make this run the new baseline
//   npm run metrics -- --only holdout     one set
//   npm run metrics -- --worst crossings  the diagrams that score worst on one metric
//   npm run metrics -- --json out.json    ... and write every count as JSON (totals, difference from the baseline, each diagram)
//   npm run metrics -- --check            exit 1 when the held-out set is worse than the baseline (for a pipeline)
//
// Every metric counts something bad, so lower is better.
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('./measure.js');

const root = path.join(__dirname, '..');
const NAMES = {
  crash: 'diagrams that fail to draw',
  through: 'links through a node',
  near: 'links within 6px of a node',
  overlap: 'links on top of each other (within 8px)',
  crossings: 'link crossings',
  bends: 'bends',
  border: 'links along a frame border',
  labels: 'labels crossed by a link',
  nodeOverlap: 'nodes overlapping',
  frameCover: 'frames covering a node not their own',
  wide: 'strips wider than 3.5:1',
  hug: 'links turning within 10px of a node',
};

const eq = (a, b) => Math.abs(a - b) < 0.5;
function measureOne(res) {
  const m = Object.fromEntries(Object.keys(NAMES).map(k => [k, 0]));
  const rm = res.rm;
  const E = rm.edges.filter(r => r.pts && r.pts.length > 1 && !r.e.rail && !r.e.lifeline && !r.e.divider && r.e.a !== r.e.b);
  const nodes = rm.nodes.filter(n => n.x !== undefined);
  const hitBox = (a, b, n, g) => Math.min(a.x, b.x) < n.x + n.w + g && n.x - g < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h + g && n.y - g < Math.max(a.y, b.y);
  for (const r of E) {
    m.bends += Math.max(0, r.pts.length - 2);
    let through = false, near = false;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      for (const n of nodes) {
        if (n.id === r.e.a || n.id === r.e.b) continue;
        if (hitBox(a, b, n, -1)) through = true; else if (hitBox(a, b, n, 6)) near = true;
      }
      for (const f of rm.frames) {
        if (eq(a.x, b.x) && Math.min(Math.max(a.y, b.y), f.y + f.h) - Math.max(Math.min(a.y, b.y), f.y) > 20 && (Math.abs(a.x - f.x) < 8 || Math.abs(a.x - f.x - f.w) < 8)) m.border++;
        if (eq(a.y, b.y) && Math.min(Math.max(a.x, b.x), f.x + f.w) - Math.max(Math.min(a.x, b.x), f.x) > 20 && (Math.abs(a.y - f.y) < 8 || Math.abs(a.y - f.y - f.h) < 8)) m.border++;
      }
    }
    if (through) m.through++; else if (near) m.near++;
    const q = r.pts, L = q.length;
    // (a bus branch starts on its bus line, at the hub: that first stretch is the line, not a turn against a box)
    if (L > 2 && !r.merged && (Math.abs(q[0].x - q[1].x) + Math.abs(q[0].y - q[1].y) < 10 || Math.abs(q[L - 1].x - q[L - 2].x) + Math.abs(q[L - 1].y - q[L - 2].y) < 10)) m.hug++;
  }
  const X = (a, b, c, d) => {
    const h1 = eq(a.y, b.y), h2 = eq(c.y, d.y);
    if (h1 === h2) return false;
    const [H0, H1, V0, V1] = h1 ? [a, b, c, d] : [c, d, a, b];
    return Math.min(H0.x, H1.x) + 0.5 < V0.x && V0.x < Math.max(H0.x, H1.x) - 0.5 && Math.min(V0.y, V1.y) + 0.5 < H0.y && H0.y < Math.max(V0.y, V1.y) - 0.5;
  };
  const OV = (a, b, c, d) => (eq(a.y, b.y) && eq(c.y, d.y) && Math.abs(a.y - c.y) < 8 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 8)
    || (eq(a.x, b.x) && eq(c.x, d.x) && Math.abs(a.x - c.x) < 8 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 8);
  const isTable = id => nodes.some(n => n.id === id && n.cols);
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const A = E[i], B = E[j];
    const share = A.e.a === B.e.a || A.e.a === B.e.b || A.e.b === B.e.a || A.e.b === B.e.b;
    let ov = false;
    for (let a = 1; a < A.pts.length; a++) for (let b = 1; b < B.pts.length; b++) {
      if (!share && X(A.pts[a - 1], A.pts[a], B.pts[b - 1], B.pts[b])) m.crossings++;
      if (OV(A.pts[a - 1], A.pts[a], B.pts[b - 1], B.pts[b])) ov = true;
    }
    const exempt = (A.merged && B.merged) || (A.e.b === B.e.b && isTable(A.e.b)) || (A.e.a === B.e.a && isTable(A.e.a)) || (A.e.a === B.e.a && A.e.b === B.e.b) || (A.e.a === B.e.b && A.e.b === B.e.a);
    if (ov && !exempt) m.overlap++;
  }
  for (const r of E) {
    if (!r.lab || !r.e.lab) continue;
    const w = r.e.lab.w, h = r.e.lab.h, x0 = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x;
    const box = { x: x0 + 1, y: r.lab.y + 1, w: w - 2, h: h - 2 };
    if (E.some(o => o !== r && o.pts.some((p, i) => i && hitBox(o.pts[i - 1], p, box, 0)))) m.labels++;
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (hitBox({ x: nodes[i].x + 1, y: nodes[i].y + 1 }, { x: nodes[i].x + nodes[i].w - 1, y: nodes[i].y + nodes[i].h - 1 }, nodes[j], 0)) m.nodeOverlap++;
  const owns = (f, n) => { for (let p = n.parent; p; p = p.parent) if (p === f) return true; return false; };
  for (const f of rm.frames) for (const n of nodes) if (!owns(f.f, n) && !(n.tags || []).includes('bridge') && hitBox({ x: n.x + 2, y: n.y + 2 }, { x: n.x + n.w - 2, y: n.y + n.h - 2 }, f, 0) && f.x < n.x && n.x + n.w < f.x + f.w && f.y < n.y && n.y + n.h < f.y + f.h) m.frameCover++;
  if (rm.width / rm.height > 3.5) m.wide = 1;
  return m;
}

async function runSet(items) {
  const rows = [];
  for (const it of items) {
    let m;
    try {
      const res = await compile(it.src, measure, ELK, {});
      if (res.errors.length || !res.rm) { m = { crash: 1 }; m.error = res.errors.length ? `line ${res.errors[0].line}: ${res.errors[0].msg}` : 'empty'; }
      else m = measureOne(res);
    } catch (e) { m = { crash: 1, error: String(e.message || e).slice(0, 120) }; }
    rows.push({ name: it.name, m });
  }
  const total = Object.fromEntries(Object.keys(NAMES).map(k => [k, rows.reduce((t, r) => t + (r.m[k] || 0), 0)]));
  return { rows, total, n: items.length };
}

function examples() {
  const out = [];
  for (const g of ['cases', 'cases/simple', 'playground']) for (const f of fs.readdirSync(path.join(root, 'examples', g)).filter(f => f.endsWith('.trace')).sort())
    out.push({ name: `${g}/${f}`, src: fs.readFileSync(path.join(root, 'examples', g, f), 'utf8') });
  return out;
}
const holdout = () => fs.readdirSync(path.join(root, 'examples', 'holdout')).filter(f => f.endsWith('.trace')).sort()
  .map(f => ({ name: `holdout/${f}`, src: fs.readFileSync(path.join(root, 'examples', 'holdout', f), 'utf8') }));

(async () => {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const only = opt('--only', null), worst = opt('--worst', null);
  const basePath = path.join(root, 'metrics', 'baseline.json');
  const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : null;
  const sets = {};
  if (!only || only === 'examples') sets.examples = await runSet(examples());
  if (!only || only === 'holdout') sets.holdout = await runSet(holdout());
  const pad = (s, w) => String(s).padEnd(w), num = (v, w) => String(v).padStart(w);
  for (const [k, set] of Object.entries(sets)) {
    const b = base && base.sets && base.sets[k] && base.sets[k].n === set.n ? base.sets[k] : null;
    console.log(`\n${k}: ${set.n} diagrams${b ? '  (compared with the baseline)' : ''}`);
    for (const key of Object.keys(NAMES)) {
      const v = set.total[key], d = b ? v - (b.total[key] || 0) : null;
      const mark = d === null || d === 0 ? '' : d < 0 ? `  ${d} better` : `  +${d} WORSE`;
      console.log(`  ${pad(NAMES[key], 44)} ${num(v, 6)}${mark}`);
    }
    const crashed = set.rows.filter(r => r.m.crash);
    for (const r of crashed.slice(0, 5)) console.log(`    fails: ${r.name}: ${r.m.error}`);
    if (worst && NAMES[worst]) {
      const top = [...set.rows].sort((a, c) => (c.m[worst] || 0) - (a.m[worst] || 0)).filter(r => r.m[worst]).slice(0, 8);
      console.log(`  worst for ${NAMES[worst]}: ${top.map(r => `${r.name} (${r.m[worst]})`).join(', ') || 'none'}`);
    }
  }
  // for a pipeline: everything as JSON (totals, the difference from the baseline, each diagram's counts)
  const jsonAt = opt('--json', null);
  const report = {};
  for (const [k, set] of Object.entries(sets)) {
    const b = base && base.sets && base.sets[k] && base.sets[k].n === set.n ? base.sets[k] : null;
    const delta = b ? Object.fromEntries(Object.keys(NAMES).map(key => [key, set.total[key] - (b.total[key] || 0)])) : null;
    report[k] = { n: set.n, total: set.total, baseline: b ? b.total : null, delta, worse: delta ? Object.keys(delta).filter(key => delta[key] > 0) : null,
      diagrams: set.rows.map(r => ({ name: r.name, ...r.m })) };
  }
  if (jsonAt) { fs.mkdirSync(path.dirname(path.resolve(jsonAt)), { recursive: true }); fs.writeFileSync(path.resolve(jsonAt), JSON.stringify(report, null, 2) + '\n'); console.log(`\nmetrics written to ${jsonAt}`); }
  // the rule for a layout change: the held-out set does not get worse than the baseline
  if (args.includes('--check')) {
    const h = report.holdout;
    if (!h || !h.delta) { console.log('\ncheck: no held-out baseline with the same number of diagrams to compare with'); process.exitCode = 1; }
    else if (h.worse.length) { console.log(`\ncheck failed: the held-out set is worse on ${h.worse.map(k => NAMES[k]).join(', ')}`); process.exitCode = 1; }
    else console.log('\ncheck passed: the held-out set is no worse than the baseline');
  }
  if (args.includes('--save')) {
    fs.mkdirSync(path.dirname(basePath), { recursive: true });
    fs.writeFileSync(basePath, JSON.stringify({ sets: Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { n: s.n, total: s.total }])) }, null, 2) + '\n');
    console.log(`\nbaseline saved to ${path.relative(root, basePath)}`);
  }
})();
