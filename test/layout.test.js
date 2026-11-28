// Every example lays out with no errors, and the drawing keeps the invariants that earlier bugs broke: no overlapping
// nodes, no frame covering a node from elsewhere, no link through a node, no two links on top of each other, no slanted link.
const test = require('node:test');
const assert = require('node:assert');
const { fs, path, ELK, compile, parse, FONT_NOTE, measure, root, files, overlap, owns, readFx, frameBox, within, noOverlap, compileFile } = require('./helpers.js');

for (const file of files) {
  test(file, async () => {
    const res = await compileFile(file);
    assert.deepStrictEqual(res.errors, [], 'parse errors');
    const nodes = res.rm.nodes;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      assert.ok(!overlap(nodes[i], nodes[j], 1), `nodes overlap: ${nodes[i].id} and ${nodes[j].id}`);
    }
    for (const fr of res.model.mode === 'sequence' ? [] : res.rm.frames) {
      for (const n of nodes) {
        if (owns(fr.f, n) || n.tags.includes('bridge')) continue;
        assert.ok(!overlap(fr, n, 1), `frame ${fr.f.id} covers foreign node ${n.id}`);
      }
    }
    assert.match(res.standalone(), /^<svg /);
  });
}

test('every link of every example starts at its source and ends at its target', async () => {
  const near = (p, n) => p.x >= n.x - 4 && p.x <= n.x + n.w + 4 && p.y >= n.y - 4 && p.y <= n.y + n.h + 4;
  for (const file of files) {
    const res = await compileFile(file);
    if (res.model.mode === 'sequence') continue;
    const N = new Map(res.rm.nodes.map(n => [n.id, n]));
    for (const { e, pts } of res.rm.edges) {
      const A = N.get(e.a), B = N.get(e.b);
      if (!A || !B || !pts.length) continue;
      assert.ok(near(pts[0], A) && near(pts[pts.length - 1], B), `${file}: ${e.a} -> ${e.b} does not reach its ends`);
    }
  }
});

test('no link runs along a frame border in the middle of its path', async () => {
  const simp = pts => { const o = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const a = o[o.length - 1], b = pts[i], c = pts[i + 1]; if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) continue; if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) continue; o.push(b); } o.push(pts[pts.length - 1]); return o; };
  for (const file of files) {
    const res = await compileFile(file);
    if (res.model.mode === 'sequence') continue;
    for (const { e, pts } of res.rm.edges) {
      if (e.rail) continue;
      const q = simp(pts);
      for (let k = 1; k < q.length - 2; k++) {   // not the first or last stretch: those stay on their nodes
        const a = q[k], b = q[k + 1];
        for (const f of res.rm.frames) {
          if (Math.abs(a.y - b.y) < 0.5) {
            const ov = Math.min(Math.max(a.x, b.x), f.x + f.w) - Math.max(Math.min(a.x, b.x), f.x);
            for (const by of [f.y, f.y + f.h]) assert.ok(!(Math.abs(a.y - by) < 8 && ov > 12), `${file}: ${e.a} -> ${e.b} runs along the ${f.f.id} frame`);
          } else if (Math.abs(a.x - b.x) < 0.5) {
            const ov = Math.min(Math.max(a.y, b.y), f.y + f.h) - Math.max(Math.min(a.y, b.y), f.y);
            for (const bx of [f.x, f.x + f.w]) assert.ok(!(Math.abs(a.x - bx) < 8 && ov > 12), `${file}: ${e.a} -> ${e.b} runs along the ${f.f.id} frame`);
          }
        }
      }
    }
  }
});

test('no link label is crossed by a link in any example', async () => {
  for (const file of files) {
    const res = await compileFile(file);
    if (res.model.mode === 'sequence') continue;
    for (const r of res.rm.edges) {
      if (!r.lab || !r.e.lab || r.e.lifeline || r.e.divider) continue;
      const w = r.e.lab.w, h = r.e.lab.h;
      const x0 = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x;
      const b = { x: x0, y: r.lab.y, w, h };
      for (const o of res.rm.edges) {
        if (!o.pts) continue;
        for (let i = 1; i < o.pts.length; i++) {
          const a = o.pts[i - 1], p = o.pts[i];
          assert.ok(!(Math.min(a.x, p.x) < b.x + b.w && b.x < Math.max(a.x, p.x) && Math.min(a.y, p.y) < b.y + b.h && b.y < Math.max(a.y, p.y)),
            `${file}: the label "${r.e.label}" is crossed by the link ${o.e.a || ''} -> ${o.e.b || ''}`);
        }
      }
    }
  }
});

test('no link runs through a node that is not one of its ends, in any example', async () => {
  for (const file of files) {
    const res = await compileFile(file);
    for (const r of res.rm.edges) {
      if (!r.pts || r.e.rail || r.e.lifeline || r.e.divider) continue;
      for (const n of res.rm.nodes) {
        if (n.x === undefined || n.id === r.e.a || n.id === r.e.b) continue;
        for (let i = 1; i < r.pts.length; i++) {
          const a = r.pts[i - 1], b = r.pts[i];
          const hit = Math.min(a.x, b.x) < n.x + n.w - 1 && n.x + 1 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h - 1 && n.y + 1 < Math.max(a.y, b.y);
          assert.ok(!hit, `${file}: ${r.e.a} -> ${r.e.b} runs through ${n.id}`);
        }
      }
    }
  }
});

test('every link is orthogonal: each stretch is horizontal or vertical, in every example and held-out diagram', async () => {
  const holdout = fs.readdirSync(path.join(root, 'examples/holdout')).filter(f => f.endsWith('.trace')).map(f => 'examples/holdout/' + f);
  for (const file of [...files, ...holdout]) {
    const res = await compileFile(file);
    for (const r of res.rm.edges) {
      if (!r.pts || r.e.rail) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        assert.ok(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5, `${file}: ${r.e.a} -> ${r.e.b} has a slanted stretch from (${Math.round(a.x)}, ${Math.round(a.y)}) to (${Math.round(b.x)}, ${Math.round(b.y)})`);
      }
    }
  }
});

test('no two links lie on top of each other, in any example (links merged into one bus excepted)', async () => {
  const ov = (a, b, c, d) => {
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5) return Math.abs(a.y - c.y) < 7 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 8;
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5) return Math.abs(a.x - c.x) < 7 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 8;
    return false;
  };
  const bad = [];
  for (const file of files) {
    const res = await compileFile(file);
    const E = res.rm.edges.filter(r => r.pts && !r.e.rail && !r.e.lifeline && !r.e.divider);
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const A = E[i], B = E[j];
      if (A.merged && B.merged && A.mergeHub === B.mergeHub) continue;   // a bus is shared on purpose (two buses are not)
      // links into the same row of a table converge there (the ER convention), and two links between the same
      // two nodes run side by side by nature
      const tab = id => res.rm.nodes.find(n => n.id === id && n.cols);
      if ((A.e.b === B.e.b && tab(A.e.b)) || (A.e.a === B.e.a && tab(A.e.a))) continue;
      if ((A.e.a === B.e.a && A.e.b === B.e.b) || (A.e.a === B.e.b && A.e.b === B.e.a)) continue;
      // two links that leave or reach the same node may share the first few pixels at the port
      let hit = false;
      for (let a = 1; a < A.pts.length && !hit; a++) for (let b = 1; b < B.pts.length && !hit; b++) if (ov(A.pts[a - 1], A.pts[a], B.pts[b - 1], B.pts[b])) hit = true;
      if (hit) bad.push(`${file}: ${A.e.a}->${A.e.b} / ${B.e.a}->${B.e.b}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('no zone title is crossed by a link in any example (a zone with no free place grows to make one)', async () => {
  for (const file of files) {
    const res = await compileFile(file);
    if (res.errors.length) continue;
    for (const fr of res.rm.frames) {
      if (!fr.f.title || fr.f.logo) continue;
      const m = res.svg.match(new RegExp(`<text class="ztitle muted" x="([\\d.]+)" y="([\\d.]+)" text-anchor="(\\w+)">${fr.f.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}</text>`));
      if (!m) continue;
      const x = +m[1], y = +m[2], w = fr.f.titleW, x0 = m[3] === 'end' ? x - w : x;
      const hit = res.rm.edges.some(r => r.pts && !r.e.lifeline && r.pts.some((q, i) => i && Math.min(r.pts[i - 1].x, q.x) < x0 + w && x0 < Math.max(r.pts[i - 1].x, q.x) && Math.min(r.pts[i - 1].y, q.y) < y + 3 && y - 11 < Math.max(r.pts[i - 1].y, q.y)));
      assert.ok(!hit, `${file}: the title of ${fr.f.id} is not crossed by a link`);
    }
  }
});

test('no two zones that are not nested overlap, in any example or held-out diagram (a title too long for its room is shortened)', async () => {
  const holdout = fs.readdirSync(path.join(root, 'examples/holdout')).filter(f => f.endsWith('.trace')).map(f => 'examples/holdout/' + f);
  const bad = [];
  for (const file of [...files, ...holdout]) {
    const res = await compileFile(file);
    const F = res.rm.frames, nest = (x, y) => { for (let p = x.f.parent; p; p = p.parent) if (p === y.f) return true; return false; };
    for (const a of F) for (const b of F) if (a.f.id < b.f.id && !/^_seq/.test(a.f.id) && !/^_seq/.test(b.f.id) && !nest(a, b) && !nest(b, a) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2) bad.push(`${file}: ${a.f.id} / ${b.f.id}`);
  }
  assert.deepStrictEqual(bad, []);
  const res = await compileFile('examples/holdout/unifi-home-vlans.trace');
  assert.match(res.svg, /VLAN_SERVERS[^<]*…<title>VLAN_SERVERS — Secure Server Net · YOUR_SERVER_SUBNET<\/title>/);
});
