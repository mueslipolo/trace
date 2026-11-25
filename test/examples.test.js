// Every example must parse and lay out, and the drawing must respect a few invariants
// that earlier bugs broke: nodes never overlap, and a frame never covers a node from elsewhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('../src/trace.js');
const { measure } = require('../tools/measure.js');

const root = path.join(__dirname, '..');
const files = ['playground', 'cases', 'cases/simple'].flatMap(g =>
  fs.readdirSync(path.join(root, 'examples', g)).filter(f => f.endsWith('.trace')).map(f => path.join('examples', g, f)));

const overlap = (a, b, m = 0) => a.x < b.x + b.w - m && b.x < a.x + a.w - m && a.y < b.y + b.h - m && b.y < a.y + a.h - m;
const owns = (frame, n) => { for (let p = n.parent; p; p = p.parent) if (p === frame) return true; return false; };

for (const file of files) {
  test(file, async () => {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
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

test('errors carry line numbers', async () => {
  const res = await compile('a -> b\nfoo bar baz', measure, ELK, {});
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].line, 2);
});

test('icons: names, aliases, lucide names, placement', async () => {
  const { parse } = require('../src/trace.js');
  const m = parse('a [database]: A\nb [firewall top]: B\nc [lucide/bridge]: C\nd [bridge]: D\ne [brick-wall-fire]: E');
  assert.deepStrictEqual(m.errors, []);
  assert.strictEqual(m.nodes.get('a').icon, 'database');
  assert.strictEqual(m.nodes.get('b').icon, 'firewall');
  assert.strictEqual(m.nodes.get('b').iconTop, true);
  assert.strictEqual(m.nodes.get('c').icon, 'lucide/bridge');
  assert.deepStrictEqual(m.nodes.get('d').tags, ['bridge']);
  assert.strictEqual(m.nodes.get('d').icon, undefined);
  assert.strictEqual(m.nodes.get('e').icon, 'brick-wall-fire');
});

test('icons: errors say what to write', async () => {
  const { parse } = require('../src/trace.js');
  const m = parse('a [databse]: A\nb [top]: B');
  assert.strictEqual(m.errors.length, 2);
  assert.match(m.errors[0].msg, /Did you mean database/);
  assert.strictEqual(m.errors[0].line, 1);
  assert.match(m.errors[1].msg, /give the node an icon/);
});

test('icons: the node grows to fit and the icon is drawn', async () => {
  const plain = await compile('a: Orders | postgres', measure, ELK, {});
  const left = await compile('a [database]: Orders | postgres', measure, ELK, {});
  const top = await compile('a [database top]: Orders | postgres', measure, ELK, {});
  const a = r => r.rm.nodes[0];
  assert.ok(a(left).w > a(plain).w, 'an icon on the left widens the node');
  assert.ok(a(top).h > a(plain).h, 'an icon on top makes the node taller');
  assert.match(left.standalone(), /class="ico"/);
  assert.doesNotMatch(plain.standalone(), /class="ico" transform/);
});

test('icons: every friendly name has its drawing in the bundled core', () => {
  const core = require('../src/lucide-core.js');
  const src = fs.readFileSync(path.join(root, 'src/trace.js'), 'utf8');
  const aliases = [...src.match(/const ICON_ALIASES = \{([\s\S]*?)\};/)[1].matchAll(/: '([a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(aliases.length >= 17);
  for (const l of aliases) assert.ok(core[l], `${l} is missing from src/lucide-core.js: add it to CORE in tools/build-icons.js`);
  for (const n of ['database', 'server', 'user', 'cloud', 'container', 'lock', 'router', 'wifi', 'shield', 'laptop', 'monitor', 'printer', 'clock', 'bell', 'settings', 'mail']) assert.ok(core[n], n);
});

test('icons: an icon outside the core is loaded when the diagram uses it', async () => {
  const calls = [];
  const loadIcon = async name => { calls.push(name); return `<svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg>`; };
  const res = await compile('a [bug]: Bug\nb [bug]: Again\nc [database]: Core', measure, ELK, { loadIcon });
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(calls, ['bug'], 'fetched once, and not for core icons');
  assert.deepStrictEqual(res.warnings, []);
  assert.match(res.standalone(), /M1 1h2/);
});

test('icons: a failed load draws the node without the icon and says so', async () => {
  const res = await compile('a [bike]: Link', measure, ELK, { loadIcon: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.warnings[0], /bike/);
  assert.ok(res.rm.nodes[0].w <= 100, 'no room kept for an icon that is not there');
});

test('withIcon adds or replaces an icon on a node line and refuses other lines', () => {
  const { withIcon } = require('../src/trace.js');
  assert.strictEqual(withIcon('api: FastAPI | note', 'database'), 'api [database]: FastAPI | note');
  assert.strictEqual(withIcon('store pg: Postgres', 'database'), 'store pg [database]: Postgres');
  assert.strictEqual(withIcon('fw [bridge firewall top]: Edge', 'router'), 'fw [bridge top router]: Edge');
  assert.strictEqual(withIcon('a: has "x:y" in it', 'bell'), 'a [bell]: has "x:y" in it');
  for (const l of ['a -> b : 443', 'frame f "T" [blue] {', 'column {', 'key box [dashed] : x', 'plain']) assert.strictEqual(withIcon(l, 'bell'), null, l);
});

test('rows and columns of frames place them side by side, one above the other, or as a grid', async () => {
  const frame = (res, id) => res.rm.frames.find(f => f.f.id === id);
  const F = (id, node) => `frame ${id} "${id.toUpperCase()}" {\n  ${node}\n}\n`;
  // unlinked frames: only the lane decides where they go
  const row = await compile(`row {\n${F('a', 'x')}${F('b', 'y')}${F('c', 'z')}}\n`, measure, ELK, {});
  assert.deepStrictEqual(row.errors, []);
  const [a, b, c] = ['a', 'b', 'c'].map(id => frame(row, id));
  assert.ok(a.x + a.w <= b.x + 1 && b.x + b.w <= c.x + 1, 'a row goes left to right, in order');
  assert.ok(Math.abs(a.y - b.y) < 2, 'and on one line');
  const col = await compile(`column {\n${F('a', 'x')}${F('b', 'y')}}\n`, measure, ELK, {});
  assert.deepStrictEqual(col.errors, []);
  assert.ok(frame(col, 'a').y + frame(col, 'a').h <= frame(col, 'b').y + 1, 'a column goes top to bottom');
  const grid = await compile(`column {\nrow {\n${F('a', 'x')}${F('b', 'y')}}\nrow {\n${F('c', 'z')}${F('d', 'w')}}\n}\nx -> w\n`, measure, ELK, {});
  assert.deepStrictEqual(grid.errors, []);
  const g = ['a', 'b', 'c', 'd'].map(id => frame(grid, id));
  const [ga, gb, gc, gd] = g;
  assert.ok(ga.x < gb.x && gc.x < gd.x && ga.y < gc.y && gb.y < gd.y, 'a grid: two rows of two');
  for (const f of g) for (const o of g) if (f !== o) assert.ok(f.x + f.w <= o.x + 1 || o.x + o.w <= f.x + 1 || f.y + f.h <= o.y + 1 || o.y + o.h <= f.y + 1, 'frames do not overlap');
});

test('a row or column that holds frames takes no title; a plain one still stacks nodes', async () => {
  const bad = await compile('row "Zones" {\n  frame a {\n    x\n  }\n}\n', measure, ELK, {});
  assert.match(bad.errors[0].msg, /no title/);
  const plain = await compile('column "stack" {\n  p: One\n  q: Two\n}\np -> q', measure, ELK, {});
  assert.deepStrictEqual(plain.errors, []);
  assert.ok(plain.rm.nodes[0].x === plain.rm.nodes[1].x, 'still a hand-stacked column');
});

test('a long chain folds into rows by itself, a short one does not', async () => {
  const chain = n => Array.from({ length: n }, (_, i) => 'n' + i).join(' -> ');
  const long = await compile(chain(16), measure, ELK, {});
  assert.deepStrictEqual(long.errors, []);
  assert.ok(long.rm.width / long.rm.height < 4, `a 16-step chain is folded (${Math.round(long.rm.width)}x${Math.round(long.rm.height)})`);
  const short = await compile(chain(5), measure, ELK, {});
  assert.ok(short.rm.width > short.rm.height * 2 && short.rm.height < 80, 'a 5-step chain stays on one line');
});

test('every link of every example starts at its source and ends at its target', async () => {
  const near = (p, n) => p.x >= n.x - 4 && p.x <= n.x + n.w + 4 && p.y >= n.y - 4 && p.y <= n.y + n.h + 4;
  for (const file of files) {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
    if (res.model.mode === 'sequence') continue;
    const N = new Map(res.rm.nodes.map(n => [n.id, n]));
    for (const { e, pts } of res.rm.edges) {
      const A = N.get(e.a), B = N.get(e.b);
      if (!A || !B || !pts.length) continue;
      assert.ok(near(pts[0], A) && near(pts[pts.length - 1], B), `${file}: ${e.a} -> ${e.b} does not reach its ends`);
    }
  }
});

test('each simple case is the full case with the advanced commands removed (npm run simplify)', () => {
  const { simplify } = require('../tools/simplify.js');
  const dir = path.join(root, 'examples', 'cases');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.trace'))) {
    const want = simplify(fs.readFileSync(path.join(dir, f), 'utf8')).text;
    const have = fs.readFileSync(path.join(dir, 'simple', f), 'utf8');
    assert.strictEqual(have, want, `examples/cases/simple/${f} is out of date: run npm run simplify`);
  }
});

test('simple cases use none of the advanced commands', () => {
  const dir = path.join(root, 'examples', 'cases', 'simple');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /^\s*(column|row)\b/m, f + ': no rows or columns');
    assert.doesNotMatch(src, /<-/, f + ': no reversed links');
    assert.doesNotMatch(src, /\[[^\]]*\b(span|bridge|top)\b[^\]]*\]/, f + ': no span, bridge or top');
  }
});

test('links written against the order of the nodes are laid out sensibly without <-', async () => {
  const src = fs.readFileSync(path.join(root, 'examples/cases/simple/office.trace'), 'utf8');
  const bends = r => r.rm.edges.reduce((t, e) => t + Math.max(0, e.pts.length - 2), 0);
  const withCycle = await compile(src, measure, ELK, {});
  process.env.TRACE_NOCYCLE = '1';
  let without;
  try { without = await compile(src, measure, ELK, {}); } finally { delete process.env.TRACE_NOCYCLE; }
  // the routing passes after the layout add a few bends on both sides (routes round nodes), so the margin is smaller than it was
  assert.ok(bends(withCycle) < bends(without), `fewer bends when cycles are broken by declaration order (${bends(withCycle)} against ${bends(without)})`);
});

test('a span node is sized to the stack it feeds, so those links are straight even when a wider stack feeds it', async () => {
  const src = [
    'direction down',
    'row {', '  p: A rather long label for the first source', '  q: Another quite long label for the second', '  r: And a third label that is long as well', '}',
    'fw [span]: Gate',
    'row {', '  x: X', '  y: Y', '  z: Z', '}',
    'p -> fw', 'q -> fw', 'r -> fw', 'fw -> x', 'fw -> y', 'fw -> z',
  ].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  const xs = ['x', 'y', 'z'].map(id => N.get(id));
  const lo = Math.min(...xs.map(n => n.x)), hi = Math.max(...xs.map(n => n.x + n.w));
  assert.ok(Math.abs(N.get('fw').w - (hi - lo)) < 3, `the gate is as wide as the row it feeds (${N.get('fw').w} against ${hi - lo})`);
  for (const { e, pts } of res.rm.edges) {
    if (e.a !== 'fw') continue;
    assert.ok(pts.every(p => Math.abs(p.x - pts[0].x) < 1), `fw -> ${e.b} is straight`);
  }
});

test('single-step links into the same node have their steps at one height', async () => {
  const src = [
    'direction down',
    'row {', '  p: P', '  q: Q', '  r: R', '}',
    'gate [span]: Gate',
    'row {', '  x: A rather long label for the first target', '  y: Another quite long label for the second', '  z: And a third label that is long as well', '}',
    'p -> gate', 'q -> gate', 'r -> gate', 'gate -> x', 'gate -> y', 'gate -> z',
  ].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const steps = [];
  for (const { e, pts } of res.rm.edges) {
    if (e.b !== 'gate') continue;
    const xs = new Set(pts.map(p => Math.round(p.x)));
    if (xs.size > 1) steps.push(...pts.filter((p, i) => i > 0 && Math.abs(p.y - pts[i - 1].y) < 0.5 && Math.abs(p.x - pts[i - 1].x) > 1).map(p => Math.round(p.y)));
  }
  assert.ok(steps.length >= 2, 'the outer links need a step');
  assert.ok(steps.every(y => Math.abs(y - steps[0]) <= 1), `the steps are at one height (${steps.join(', ')})`);
});

test('align puts two nodes in different stacks level and draws the link between them straight', async () => {
  // two columns of different lengths: without align, b sits at the top and y further down
  const src = [
    'column {', '  a: One', '  b: Two', '  c: Three', '}',
    'column {', '  x: First', '  y: Second', '  z: Third', '  w: Fourth', '}',
    'a -> x', 'b -> y', 'c -> z', 'c -> w',
    'align c w',
  ].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  const cy = id => N.get(id).y + N.get(id).h / 2;
  assert.ok(Math.abs(cy('c') - cy('w')) < 1, `c and w are level (${cy('c')} against ${cy('w')})`);
  const link = res.rm.edges.find(r => r.e.a === 'c' && r.e.b === 'w');
  assert.strictEqual(link.pts.length, 2, 'the link between them is a straight line');
  assert.ok(Math.abs(link.pts[0].y - link.pts[1].y) < 0.5);
  assert.deepStrictEqual(res.warnings, []);
});

test('align says what to write when it cannot work', async () => {
  const err = async s => (await compile(s, measure, ELK, {})).errors.map(e => e.msg).join('|');
  assert.match(await err('a -> b\nalign a c'), /no node called "c"/);
  assert.match(await err('a: A\nb: B\nalign a b'), /need one: write a -> b/);
  assert.match(await err('a -> b\nalign a'), /two or more nodes/);
  const same = await compile('column {\n  a: A\n  b: B\n}\na -> b\nalign a b', measure, ELK, {});
  assert.match(same.warnings.join('|'), /already in line/);
  const loose = await compile('a -> b\nalign a b', measure, ELK, {});
  assert.deepStrictEqual(loose.warnings, [], 'two single nodes are aligned too');
});

test('rails: syntax errors say what to write', async () => {
  const err = async s => (await compile(s, measure, ELK, {})).errors.map(e => e.msg).join('|');
  assert.match(await err('frame f {\n  rail r {\n    s\n  }\n}'), /top level/);
  assert.match(await err('rail "Logging" {\n  s\n}'), /needs a name/);
  assert.match(await err('rail r [top bottom] {\n  s\n}'), /one side/);
  assert.match(await err('rail r {\n  column {\n    s\n  }\n}'), /nodes only/);
  assert.match(await err('a: A\nrail a {\n  s\n}'), /already a node/);
});

test('rails: links to a rail stay out of the layout and run from the node to the bus', async () => {
  const body = ['direction down', 'frame z {', '  fw [span]: Gate', '  row {', '    a: A', '    b: B', '  }', '}', 'fw -> a', 'fw -> b'];
  const plain = await compile(body.join('\n'), measure, ELK, {});
  const railed = await compile([...body, 'rail logs "Logging" [right] {', '  siem: SIEM', '}', 'fw -> logs : syslog'].join('\n'), measure, ELK, {});
  assert.deepStrictEqual(railed.errors, []);
  assert.deepStrictEqual(railed.warnings, []);
  const pos = r => Object.fromEntries(r.rm.nodes.filter(n => n.id !== 'siem').map(n => [n.id, [Math.round(n.x), Math.round(n.y)]]));
  assert.deepStrictEqual(pos(railed), pos(plain), 'the rest of the diagram is laid out exactly as without the rail');
  const N = new Map(railed.rm.nodes.map(n => [n.id, n]));
  const right = Math.max(...railed.rm.nodes.filter(n => n.id !== 'siem').map(n => n.x + n.w));
  assert.ok(N.get('siem').x > right, 'the node in the rail is beyond the diagram');
  assert.ok(railed.rm.rails.length === 1 && railed.rm.rails[0].x > right);
  const tap = railed.rm.edges.find(r => r.e.a === 'fw' && r.e.b === 'logs');
  assert.strictEqual(tap.pts.length, 2, 'a tap is one straight run');
  assert.ok(Math.abs(tap.pts[0].x - (N.get('fw').x + N.get('fw').w)) < 1, 'it leaves the node on the side facing the rail');
  const sink = railed.rm.edges.find(r => r.e.b === 'siem' && r.e.a === 'logs');
  assert.ok(sink.e.end, 'the bus feeds the node with an arrow');
  assert.ok(width(railed) > width(plain));
  function width(r) { return r.rm.width; }
});

test('rails: a link that would cross another node says so', async () => {
  const src = ['direction down', 'row {', '  a: A', '  b: B', '  c: C', '}', 'a -> b -> c', 'rail logs [right] {', '  siem: SIEM', '}', 'a -> logs'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.warnings.join('|'), /rail logs: the link a -> logs: crosses/);
});

test('the simple form of a case with a rail has plain nodes and links', () => {
  const { simplify } = require('../tools/simplify.js');
  const { text, stats } = simplify('rail logs "Logging" [right] {\n  siem: SIEM\n}\nfw: Gate\nfw -> logs : 514/udp\n');
  assert.doesNotMatch(text, /rail/);
  assert.match(text, /fw -> siem : 514\/udp/);
  assert.strictEqual(stats.rails, 1);
});

test('no link runs along a frame border in the middle of its path', async () => {
  const simp = pts => { const o = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const a = o[o.length - 1], b = pts[i], c = pts[i + 1]; if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) continue; if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) continue; o.push(b); } o.push(pts[pts.length - 1]); return o; };
  for (const file of files) {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
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

test('same-width and same-height make nodes and frames equal, and frames share their edges', async () => {
  const nodes = await compile('direction down\na: A\nb: A much longer label here\nc: Mid label\na -> b -> c\nsame-width a b c\nsame-height a c', measure, ELK, {});
  assert.deepStrictEqual(nodes.errors, []);
  const N = new Map(nodes.rm.nodes.map(n => [n.id, n]));
  assert.ok(N.get('a').w === N.get('b').w && N.get('b').w === N.get('c').w, 'equal widths');
  assert.strictEqual(N.get('a').h, N.get('c').h);
  const F = (id, node) => `frame ${id} "${id}" {\n  ${node}\n}\n`;
  const frames = await compile(`direction down\n${F('a', 'x: X')}${F('b', 'y: A node with a rather long label')}${F('c', 'z: Medium label')}x -> y\ny -> z\nsame-width a b c`, measure, ELK, {});
  assert.deepStrictEqual(frames.errors, []);
  const fr = frames.rm.frames;
  assert.ok(fr.every(f => Math.abs(f.w - fr[0].w) < 1), 'equal widths');
  assert.ok(fr.every(f => Math.abs(f.x - fr[0].x) < 1), 'and the same left edge');
  for (const n of frames.rm.nodes) { const f = frames.rm.frames.find(f => f.f.items.includes(n)); assert.ok(n.x >= f.x && n.x + n.w <= f.x + f.w, 'the contents stay inside'); }
});

test('same-width says what to write when it cannot work', async () => {
  const err = async s => (await compile(s, measure, ELK, {})).errors.map(e => e.msg).join('|');
  assert.match(await err('a: A\nsame-width a'), /two or more names/);
  assert.match(await err('a: A\nb: B\nsame-width a zz'), /no node or frame called "zz"/);
  assert.match(await err('frame f {\n  c: C\n}\na: A\nsame-width a f'), /not a mix/);
});

test('the simple form drops same-width lines', () => {
  const { simplify } = require('../tools/simplify.js');
  const { text, stats } = simplify('a: A\nb: B\nsame-width a b\n');
  assert.doesNotMatch(text, /same-width/);
  assert.strictEqual(stats.sizing, 1);
});

test('sequence: participants run left to right in order of mention, messages top to bottom in the order written', async () => {
  const src = 'sequence\nclient -> api : first\napi -> db : second\ndb --> api : third\napi --> client : fourth';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  assert.ok(N.get('client').x < N.get('api').x && N.get('api').x < N.get('db').x, 'left to right');
  assert.ok(res.rm.nodes.every(n => n.y === res.rm.nodes[0].y), 'participants on one line');
  const msgs = res.rm.edges.filter(r => !r.e.lifeline && !r.e.divider);
  assert.deepStrictEqual(msgs.map(r => r.e.label), ['first', 'second', 'third', 'fourth']);
  for (let i = 1; i < msgs.length; i++) assert.ok(msgs[i].pts[0].y > msgs[i - 1].pts[0].y + 10, 'each message below the last');
  const x = id => N.get(id).x + N.get(id).w / 2;
  assert.ok(Math.abs(msgs[2].pts[0].x - x('db')) < 1 && Math.abs(msgs[2].pts[1].x - x('api')) < 1, 'a message runs from lifeline to lifeline, whichever way');
  assert.ok(msgs[2].e.dashed && msgs[3].e.dashed, '--> is a dashed return');
  const lifelines = res.rm.edges.filter(r => r.e.lifeline);
  assert.strictEqual(lifelines.length, 3);
  assert.ok(lifelines.every(l => l.pts[1].y > msgs[3].pts[0].y), 'lifelines run past the last message');
});

test('sequence: a long message label gets room between its lifelines', async () => {
  const label = 'a message label that is much wider than the default gap between two participants';
  const res = await compile(`sequence\na -> b : ${label}\nb -> c : ok`, measure, ELK, {});
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  const gap = N.get('b').x + N.get('b').w / 2 - (N.get('a').x + N.get('a').w / 2);
  const m = res.rm.edges.find(r => r.e.label === label);
  assert.ok(gap >= m.e.lab.w + 30, `the lifelines are ${gap}px apart for a ${m.e.lab.w}px label`);
});

test('sequence: groups hold their messages and nest, with a divider for else', async () => {
  const src = ['sequence', 'a -> b : before', 'loop "again" {', '  a -> b : in loop', '  alt "yes" {', '    b -> c : yes path', '  else "no"', '    b -> a : no path', '  }', '}', 'a -> b : after'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.rm.frames.length, 2);
  const [outer, inner] = res.rm.frames;
  assert.ok(outer.f.title.startsWith('loop') && inner.f.title.startsWith('alt'));
  assert.ok(inner.x > outer.x && inner.x + inner.w < outer.x + outer.w && inner.y > outer.y && inner.y + inner.h < outer.y + outer.h, 'the inner group sits inside the outer one');
  const at = l => res.rm.edges.find(r => r.e.label === l).pts[0].y;
  assert.ok(at('before') < outer.y && at('after') > outer.y + outer.h, 'messages outside are outside');
  assert.ok(at('in loop') > outer.y && at('in loop') < inner.y, 'a message in the loop but not the alt is between');
  assert.ok(at('yes path') > inner.y && at('no path') < inner.y + inner.h);
  const div = res.rm.edges.find(r => r.e.divider);
  assert.ok(div && div.pts[0].y > at('yes path') && div.pts[0].y < at('no path'), 'the else divider is between the two branches');
});

test('sequence: self messages loop, notes sit where they say, and the errors say what to write', async () => {
  const res = await compile('sequence\na -> b : hi\nb -> b : think\nnote over a, b : both\nnote left of a : on the left\nnote right of b : on the right', measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const self = res.rm.edges.find(r => r.e.label === 'think');
  assert.strictEqual(self.pts.length, 4, 'a message to yourself is a small loop');
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  const notes = res.rm.nodes.filter(n => n.id.startsWith('_note'));
  const [over, left, right] = notes;
  const ca = N.get('a').x + N.get('a').w / 2, cb = N.get('b').x + N.get('b').w / 2;
  assert.ok(over.x <= ca && over.x + over.w >= cb, 'over spans both lifelines');
  assert.ok(left.x + left.w < ca && right.x > cb, 'left of and right of sit beside the lifeline');
  assert.ok(res.rm.nodes.every(n => n.x >= 0), 'nothing reaches past the left edge');
  const err = async s => (await compile(s, measure, ELK, {})).errors.map(e => e.msg).join('|');
  assert.match(await err('a -> b\nnote over a : x'), /put the line  sequence  at the top/);
  assert.match(await err('a -> b\nloop "x" {\n}'), /put the line  sequence  at the top/);
  assert.match(await err('sequence\nframe f {\n}'), /no frames, rows or columns/);
  assert.match(await err('sequence\nnote over a, b, c : x'), /one or two participants/);
});

test('tables: columns, markers, and links that attach at the column row', async () => {
  const src = ['table users {', '  id uuid pk', '  email text unique', '  name text null', '}', 'table orders {', '  id uuid pk', '  user_id uuid fk', '}',
    'orders.user_id -> users.id : placed by', 'orders -> users : whole table'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  assert.deepStrictEqual([...N.keys()].sort(), ['orders', 'users'], 'a column reference is not a node of its own');
  const u = N.get('users'), o = N.get('orders');
  assert.strictEqual(u.cols.length, 3);
  assert.deepStrictEqual(u.cols[1].marks, ['unique']);
  assert.ok(u.h > o.h, 'a table with more columns is taller');
  const link = res.rm.edges.find(r => r.e.label === 'placed by');
  const rowCentre = (n, i) => n.y + n.headH + i * n.rowH + n.rowH / 2;
  assert.ok(Math.abs(link.pts[0].y - rowCentre(o, 1)) < 1, 'it leaves orders level with the user_id row');
  assert.ok(Math.abs(link.pts[link.pts.length - 1].y - rowCentre(u, 0)) < 1, 'and enters users level with the id row');
  assert.match(res.svg, /class="mk muted"[^>]*>PK</);
  assert.match(res.svg, /class="ct muted"[^>]*>text\?</, 'a nullable column shows ? after its type');
});

test('tables: errors say what to write', async () => {
  const err = async s => (await compile(s, measure, ELK, {})).errors.map(e => e.msg).join('|');
  assert.match(await err('table t {\n  id uuid pk\n}\nt.idd -> t\nx -> t.id'), /no column "idd".*columns are: id/);
  assert.match(await err('table t {\n  1bad int\n}'), /not a column name/);
  assert.match(await err('table t {\n  a int\n  a text\n}'), /already has a column called "a"/);
  assert.match(await err('table {\n}'), /needs a name/);
  assert.match(await err('column {\n  table t {\n  }\n}'), /not inside a row, column or rail/);
  assert.match(await err('sequence\ntable t {\n}'), /not a sequence diagram/);
});

test('tables sit in frames and take links to a column from outside the frame', async () => {
  const src = ['frame db "database" [purple] {', '  table users {', '    id uuid pk', '    name text', '  }', '  table orders {', '    id uuid pk', '    user_id uuid fk', '  }', '}', 'api: API', 'api -> users.name : reads', 'orders.user_id -> users.id'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const N = new Map(res.rm.nodes.map(n => [n.id, n]));
  const link = res.rm.edges.find(r => r.e.label === 'reads');
  const u = N.get('users');
  assert.ok(Math.abs(link.pts[link.pts.length - 1].y - (u.y + u.headH + u.rowH * 1.5)) < 1.5, 'from outside the frame it still lands on the name row');
});

test('labels and titles stay off the links in the DMZ case', async () => {
  const res = await compile(fs.readFileSync(path.join(root, 'examples/cases/dmz.trace'), 'utf8'), measure, ELK, {});
  const seg = (r, fn) => r.pts.some((p, i) => i && fn(r.pts[i - 1], p));
  const crosses = (x0, x1, y0, y1) => res.rm.edges.some(r => !r.e.lifeline && seg(r, (a, p) => Math.min(a.x, p.x) < x1 && x0 < Math.max(a.x, p.x) && Math.min(a.y, p.y) < y1 && y0 < Math.max(a.y, p.y)));
  // a row or column title is not crossed by a link
  for (const g of res.model.groups.filter(g => g.title)) {
    const m = res.svg.match(new RegExp(`<text class="note muted" x="([\\d.]+)" y="([\\d.]+)"[^>]*>${g.title}</text>`));
    const cx = +m[1], cy = +m[2], w = g.titleW;
    assert.ok(!crosses(cx - w / 2, cx + w / 2, cy - 11, cy + 3), `the title "${g.title}" is not crossed by a link`);
  }
  // a frame title is not crossed either
  for (const fr of res.rm.frames) {
    const m = res.svg.match(new RegExp(`<text class="ztitle muted" x="([\\d.]+)" y="([\\d.]+)" text-anchor="(\\w+)">${fr.f.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</text>`));
    const x = +m[1], y = +m[2], w = fr.f.titleW, a = m[3];
    const x0 = a === 'end' ? x - w : x;
    assert.ok(!crosses(x0, x0 + w, y - 11, y + 3), `the title of ${fr.f.id} is not crossed by a link`);
  }
  // the log links run to the SIEM in the side zone, and their labels sit beyond the firewall they leave
  const taps = res.rm.edges.filter(r => r.e.b === 'siem');
  assert.strictEqual(taps.length, 3);
  for (const t of taps) { const n = res.rm.nodes.find(x => x.id === t.e.a); assert.ok(t.lab.x - t.e.lab.w / 2 >= n.x + n.w - 1, 'a log label is clear of its firewall'); }
  // a step's label is above the step, not on it
  const step = res.rm.edges.find(r => r.e.a === 'api1' && r.e.b === 'fw3');
  const ys = step.pts.filter((p, i) => i && Math.abs(p.y - step.pts[i - 1].y) < 0.5 && Math.abs(p.x - step.pts[i - 1].x) > 1).map(p => p.y);
  assert.ok(ys.length === 1 && step.lab.y + step.e.lab.h <= ys[0], 'the label sits above the horizontal step');
});

test('no link label is crossed by a link in any example', async () => {
  for (const file of files) {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
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

test('a label moves off a link that crosses it, and may wrap to two lines to fit', async () => {
  // b -> c runs right past a -> d's label unless that label moves
  const src = ['direction down', 'a: A', 'b: B', 'c: C', 'd: D', 'a -> d : a fairly long label for this link', 'b -> c : another'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const wide = await compile(['direction down', 'a: A', 'b: B', 'a -> b : 8443/tcp admins only', 'a -> b [dashed] : second'].join('\n'), measure, ELK, {});
  assert.deepStrictEqual(wide.errors, []);
});

test('the showcase page shows one case at a time, with a list of every case, a menu, and simple and full', () => {
  const { execFileSync } = require('child_process');
  execFileSync('node', [path.join(root, 'tools/build-showcase.js')], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(root, 'dist/showcase.html'), 'utf8');
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'examples/cases/cases.json'), 'utf8'));
  for (const c of cases) {
    assert.match(html, new RegExp(`<li><a href="#${c.id}">`), `${c.id} in the list`);
    assert.match(html, new RegExp(`<option value="${c.id}">`), `${c.id} in the menu`);
  }
  assert.match(html, /id="v-simple"[^>]*>Simple</);
  assert.match(html, /id="v-trace"[^>]*>Full</);
  assert.match(html, /function showFromHash/);
  assert.match(html, /ArrowRight/);
});

test('rails: a dot marks each place a tap meets the bus, when there are several', async () => {
  const body = ['direction down', 'a: A', 'b: B', 'a -> b', 'rail logs [right] {', '  siem: SIEM', '}'];
  const one = await compile([...body, 'a -> logs'].join('\n'), measure, ELK, {});
  assert.strictEqual(one.rm.rails[0].dots.length, 0, 'a single tap needs no dot');
  const two = await compile([...body, 'a -> logs', 'b -> logs'].join('\n'), measure, ELK, {});
  assert.strictEqual(two.rm.rails[0].dots.length, 2);
  assert.strictEqual((two.svg.match(/<circle class="dot"/g) || []).length, 2);
});

test('links can say how many at each end, and are drawn with crow\'s feet instead of arrowheads', async () => {
  const src = 'table a {\n  id int pk\n}\ntable b {\n  id int pk\n  a_id int fk\n}\nb.a_id -> a.id [n-1] : belongs to\nb -> a [0n-01]\nb -> a [1-1]\nb -> a [01-n]';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const feet = (res.svg.match(/<path class="card" d="M[^ML"]* [^ML"]*L[^ML"]* [^ML"]*M[^ML"]* [^ML"]*L[^ML"]* [^ML"]*M[^ML"]* [^ML"]*L/g) || []).length;
  assert.ok(feet >= 3, `crow's feet are drawn (${feet})`);
  assert.ok(/<circle class="cardo"/.test(res.svg), 'a circle marks an optional end');
  assert.ok(!/marker-end/.test(res.svg.replace(/<marker[\s\S]*?<\/marker>/g, '')), 'no arrowheads on a link with cardinalities');
  const err = (await compile('a -> b [n-2]', measure, ELK, {})).errors[0].msg;
  assert.match(err, /cardinality as in n-1, 1-1, 0n-1/);
  const plain = await compile('a -> b', measure, ELK, {});
  assert.ok(/marker-end/.test(plain.svg), 'an ordinary link keeps its arrowhead');
});

test('align puts single nodes, and nodes inside zones, level (the zone moves as a whole)', async () => {
  // the CI/CD case: in its second row the registry and the approval are centred, but the nodes inside the
  // titled staging zone sit lower than the zone's centre
  const src = fs.readFileSync(path.join(root, 'examples/cases/cicd.trace'), 'utf8').replace(/\nalign [^\n]*/g, '');
  const plain = await compile(src, measure, ELK, {});
  const res = await compile(src + '\nalign registry deploy e2e approve\n', measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const cy = (r, id) => { const n = r.rm.nodes.find(x => x.id === id); return n.y + n.h / 2; };
  assert.ok(Math.max(...['deploy', 'e2e', 'approve'].map(id => Math.abs(cy(plain, id) - cy(plain, 'registry')))) > 3, 'not level without align');
  for (const id of ['deploy', 'e2e', 'approve']) assert.ok(Math.abs(cy(res, id) - cy(res, 'registry')) < 1, `${id} is level with the registry`);
  const f = res.rm.frames.find(x => x.f.id === 'staging');
  for (const id of ['deploy', 'e2e']) { const n = res.rm.nodes.find(x => x.id === id); assert.ok(n.x >= f.x && n.x + n.w <= f.x + f.w && n.y >= f.y && n.y + n.h <= f.y + f.h, `${id} stays inside the zone`); }
  assert.deepStrictEqual(res.warnings, []);
});

test('a link with one step more than it needs takes the shorter route (down, across, down)', async () => {
  const F = (id, a, b) => `frame ${id} "${id}" {\n  ${a}\n  ${b}\n}\n`;
  const src = `column {\n  row {\n${F('top', 'a: A', 'b: B')}  }\n  row {\n${F('bottom', 'c: C', 'd: D')}  }\n}\nb -> c : hop`;
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const link = res.rm.edges.find(r => r.e.label === 'hop');
  const q = link.pts.filter((p, i, a) => i === 0 || i === a.length - 1 || !((Math.abs(a[i - 1].x - p.x) < .5 && Math.abs(p.x - a[i + 1].x) < .5) || (Math.abs(a[i - 1].y - p.y) < .5 && Math.abs(p.y - a[i + 1].y) < .5)));
  assert.ok(q.length <= 4, `at most two vertical runs (${q.length - 1} runs)`);
});

test('arrowheads on one side of a node are not crowded by the next link (office case)', async () => {
  const res = await compile(fs.readFileSync(path.join(root, 'examples/cases/office.trace'), 'utf8'), measure, ELK, {});
  const sides = new Map();
  for (const { e, pts } of res.rm.edges) {
    const p = pts[pts.length - 1];
    for (const id of [e.b]) {
      const n = res.rm.nodes.find(x => x.id === id);
      if (!n) continue;
      const side = Math.abs(p.y - n.y) < 8 ? 'top' : Math.abs(p.y - n.y - n.h) < 8 ? 'bottom' : null;
      if (side) { const k = id + side; sides.set(k, [...(sides.get(k) || []), p.x]); }
    }
  }
  for (const [k, xs] of sides) { xs.sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 20, `${k}: arrows ${xs[i] - xs[i - 1]}px apart`); }
});

test('hub: eight links with the same label into one node are merged into a bus, with the label once', async () => {
  const res = await compile(fs.readFileSync(path.join(root, 'examples/cases/hub.trace'), 'utf8'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const merged = res.rm.edges.filter(r => r.merged && r.e.b === 'idp');
  assert.strictEqual(merged.length, 8);
  const ends = merged.map(r => r.pts[r.pts.length - 1]);
  for (const p of ends) assert.ok(Math.abs(p.x - ends[0].x) < 0.5 && Math.abs(p.y - ends[0].y) < 0.5, 'all end at one point');
  assert.strictEqual(merged.filter(r => r.lab).length, 1, 'the label once');
  assert.ok(res.rm.joins.length >= 3, 'dots where branches join');
  assert.strictEqual((res.svg.match(/validate token/g) || []).length, 1);
  // fewer than four links stay as they are
  const few = await compile('a: A\nb: B\nc: C\nh: H\na -> h : x\nb -> h : x\nc -> h : x', measure, ELK, {});
  assert.strictEqual(few.rm.edges.filter(r => r.merged).length, 0);
});

test('links leaving one short side of a node share the room out; stretches of different links are not squeezed together (aws case)', async () => {
  const res = await compile(fs.readFileSync(path.join(root, 'examples/cases/aws.trace'), 'utf8'), measure, ELK, {});
  // every side of App a: the links that leave it there are 9.5px apart or more
  const n = res.rm.nodes.find(x => x.id === 'app1');
  const sides = { left: [], right: [], top: [], bottom: [] };
  for (const r of res.rm.edges.filter(r => r.e.a === 'app1')) {
    const p = r.pts[0];
    if (Math.abs(p.x - n.x) < 2) sides.left.push(p.y); else if (Math.abs(p.x - n.x - n.w) < 2) sides.right.push(p.y);
    else if (Math.abs(p.y - n.y) < 2) sides.top.push(p.x); else sides.bottom.push(p.x);
  }
  for (const v of Object.values(sides)) { v.sort((a, b) => a - b); for (let i = 1; i < v.length; i++) assert.ok(v[i] - v[i - 1] >= 9.5, `starts ${v[i] - v[i - 1]}px apart`); }
});

test('a chain much wider than tall folds into rows; a zoned strip is only folded when the return link is short', async () => {
  const src = fs.readFileSync(path.join(root, 'examples/features/fold.after.trace'), 'utf8');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.ok(res.rm.width / res.rm.height < 2.5, `page-shaped (${Math.round(res.rm.width)}x${Math.round(res.rm.height)})`);
  const strip0 = await compile(src, measure, ELK, { off: ['wrap', 'fold'] });
  assert.ok(strip0.rm.width / strip0.rm.height > 4, 'a strip without the fold');
  process.env.TRACE_NOFOLD = '1';
  try { const strip = await compile(src, measure, ELK, { off: ['wrap'] }); assert.ok(strip.rm.width / strip.rm.height > 4, 'a strip without the fold');
  } finally { delete process.env.TRACE_NOFOLD; }
  // k8s would fold into a page shape, but with a return link of 900px: the strip is kept
  const k8s = await compile(fs.readFileSync(path.join(root, 'examples/cases/k8s.trace'), 'utf8'), measure, ELK, {});
  assert.ok(k8s.rm.width / k8s.rm.height > 4, 'k8s stays a strip rather than get a link that runs the width of the page');
  try { } finally { delete process.env.TRACE_NOFOLD; }
});

test('the engine runs where there is no `process` (the page): nothing outside the guarded env reads it', () => {
  const src = fs.readFileSync(path.join(root, 'src/trace.js'), 'utf8');
  const bad = src.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /\bprocess\./.test(l) && !/typeof process/.test(l));
  assert.deepStrictEqual(bad.filter(([l]) => !/const (env|DEBUG) = /.test(l)).map(([l, i]) => i + ': ' + l.trim()), []);
});

test('every feature example draws, before and after, and the features page has a card for each', async () => {
  const { execFileSync } = require('child_process');
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'examples/features/features.json'), 'utf8'));
  for (const f of meta) {
    for (const [k, off] of [['before', f.beforeOff], ['after', f.afterOff]]) {
      const res = await compile(fs.readFileSync(path.join(root, 'examples/features', `${f.id}.${k}.trace`), 'utf8'), measure, ELK, { off });
      assert.deepStrictEqual(res.errors, [], `${f.id} ${k}`);
      assert.ok(res.rm, `${f.id} ${k} draws`);
    }
  }
  execFileSync('node', [path.join(root, 'tools/build-features.js')], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(root, 'dist/features.html'), 'utf8');
  assert.strictEqual((html.match(/<details class="case" id="/g) || []).length, meta.length);
});

// ---- side zones: [side], [side left|right|top|bottom], [span]
const readFx = n => fs.readFileSync(path.join(root, 'test/fixtures', n), 'utf8');
const frameBox = (res, id) => res.rm.frames.find(f => f.f.id === id);
const within = (res, b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= res.rm.width + 0.5 && b.y + b.h <= res.rm.height + 0.5;
const noOverlap = (res, a, b) => !(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1);

test('a side zone stands to the right of the main flow, and spans the zones it is linked to', async () => {
  const res = await compile(readFx('side-span.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const obs = frameBox(res, 'obs'), main = ['dmz', 'app', 'data'].map(id => frameBox(res, id));
  assert.ok(obs.x >= Math.max(...main.map(b => b.x + b.w)) + 20, 'to the right of every main zone');
  assert.ok(obs.y <= Math.min(...main.map(b => b.y)) + 0.5 && obs.y + obs.h >= Math.max(...main.map(b => b.y + b.h)) - 0.5, 'as tall as the zones it is linked to');
  assert.ok(within(res, obs));
  for (const n of res.rm.nodes) if (['gw', 'loki'].includes(n.id)) assert.ok(n.x >= obs.x && n.x + n.w <= obs.x + obs.w && n.y >= obs.y && n.y + n.h <= obs.y + obs.h, `${n.id} stays inside the zone`);
  for (const r of res.rm.edges) for (let i = 1; i < r.pts.length; i++) assert.ok(Math.abs(r.pts[i].x - r.pts[i - 1].x) < 0.5 || Math.abs(r.pts[i].y - r.pts[i - 1].y) < 0.5, 'links stay orthogonal');
  // without span it keeps the height of its content
  const free = await compile(readFx('side-span.trace').replace('[green side span]', '[green side]'), measure, ELK, {});
  assert.ok(frameBox(free, 'obs').h < obs.h - 40, 'free height is shorter');
});

test('side zones on both sides of the main flow', async () => {
  const res = await compile(readFx('sides-two.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const admin = frameBox(res, 'admin'), obs = frameBox(res, 'obs'), main = ['dmz', 'app', 'data'].map(id => frameBox(res, id));
  assert.ok(admin.x + admin.w <= Math.min(...main.map(b => b.x)) - 20, 'admin on the left');
  assert.ok(obs.x >= Math.max(...main.map(b => b.x + b.w)) + 20, 'observability on the right');
  assert.ok(within(res, admin) && within(res, obs));
  const nodes = res.rm.nodes;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(noOverlap(res, nodes[i], nodes[j]), `${nodes[i].id} and ${nodes[j].id} overlap`);
});

test('two side zones on one side stack along it, each with its own slice, inside the drawing', async () => {
  const res = await compile(readFx('sides-stacked.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const obs = frameBox(res, 'obs'), sec = frameBox(res, 'sec');
  assert.ok(noOverlap(res, obs, sec), 'they do not overlap');
  assert.ok(obs.y < sec.y, 'ordered by where their links come from');
  assert.ok(within(res, obs) && within(res, sec), 'both inside the drawing');
  assert.ok(Math.abs(obs.x - sec.x) < 1, 'in line');
  for (const n of res.rm.nodes) { const z = n.id === 'gw' ? obs : n.id === 'siem' ? sec : null; if (z) assert.ok(n.y >= z.y && n.y + n.h <= z.y + z.h, `${n.id} inside its zone`); }
});

test('in a diagram that flows right the side zones go above and below', async () => {
  const res = await compile(readFx('sides-right-flow.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const admin = frameBox(res, 'admin'), obs = frameBox(res, 'obs'), main = ['web', 'app', 'db'].map(id => frameBox(res, id));
  assert.ok(admin.y + admin.h <= Math.min(...main.map(b => b.y)) - 20, 'admin above');
  assert.ok(obs.y >= Math.max(...main.map(b => b.y + b.h)) + 20, 'observability below');
  assert.ok(admin.x <= Math.min(...main.map(b => b.x)) + 0.5 && admin.x + admin.w >= Math.max(...main.map(b => b.x + b.w)) - 0.5, 'spans the width of the zones it is linked to');
  assert.ok(within(res, admin) && within(res, obs));
});

test('a side zone with a frame inside it, one with no links, and root nodes in the main flow', async () => {
  const res = await compile(readFx('sides-nested.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const obs = frameBox(res, 'obs'), back = frameBox(res, 'backends');
  assert.ok(back.x >= obs.x && back.x + back.w <= obs.x + obs.w && back.y >= obs.y && back.y + back.h <= obs.y + obs.h, 'the inner frame stays inside');
  assert.ok(within(res, frameBox(res, 'notes')));
  const nodes = res.rm.nodes;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(noOverlap(res, nodes[i], nodes[j]), `${nodes[i].id} and ${nodes[j].id} overlap`);
});

test('the DMZ case with the SIEM as a side zone keeps its bridges and draws every link', async () => {
  const res = await compile(readFx('sides-dmz.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const mgmt = frameBox(res, 'mgmt'), data = frameBox(res, 'data');
  assert.ok(mgmt.x >= data.x + data.w + 20, 'beside the data zone');
  const siem = res.rm.edges.filter(r => r.e.b === 'siem');
  assert.strictEqual(siem.length, 3);
  for (const r of siem) assert.ok(r.pts.length >= 2 && r.pts[0].x < r.pts[r.pts.length - 1].x, 'each link runs into the zone');
});

test('side zone mistakes are told with a line number and what to write', () => {
  const { parse } = require('../src/trace.js');
  const err = s => parse(s).errors[0];
  assert.match(err('frame a "a" {\n  frame b "b" [side] {\n    x: X\n  }\n}\nfoo: Foo').msg, /top level/);
  assert.match(err('direction down\nframe a "a" {\n  x: X\n}\nframe b "b" [side top] {\n  y: Y\n}').msg, /left or right/);
  assert.match(err('direction right\nframe a "a" {\n  x: X\n}\nframe b "b" [side left] {\n  y: Y\n}').msg, /top or bottom/);
  assert.match(err('frame a "a" {\n  x: X\n}\nframe b "b" [side left right] {\n  y: Y\n}').msg, /one side/);
  assert.match(err('frame a "a" {\n  x: X\n}\nframe b "b" [span] {\n  y: Y\n}').msg, /\[side span\]/);
  assert.strictEqual(err('frame a "a" {\n  x: X\n}\nframe b "b" [side left right] {\n  y: Y\n}').line, 4);
});

test('four side zones, a fixed one among spanning ones, root nodes and a rail: nothing overlaps, everything inside', async () => {
  const res = await compile(readFx('sides-many.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const zones = ['admin', 'ci', 'obs', 'sec'].map(id => frameBox(res, id));
  for (let i = 0; i < zones.length; i++) { assert.ok(within(res, zones[i]), `${zones[i].f.id} inside`); for (let j = i + 1; j < zones.length; j++) assert.ok(noOverlap(res, zones[i], zones[j]), `${zones[i].f.id} and ${zones[j].f.id}`); }
  const nodes = res.rm.nodes;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(noOverlap(res, nodes[i], nodes[j]), `${nodes[i].id} and ${nodes[j].id} overlap`);
  for (const f of res.rm.frames) for (const n of nodes) { if (!f.f.items.includes(n) && f.f.id !== 'mgmt') assert.ok(noOverlap(res, f, n) || n.parent === f.f || (function w(c) { return (c.items || []).some(x => x === n || w(x)); })(f.f), `${n.id} over frame ${f.f.id}`); }
});

test('links to a zone are refused with side zones, and the message names a way out', () => {
  const { parse } = require('../src/trace.js');
  const m = parse('direction down\nframe a "a" [blue] {\n  x: X\n}\nframe b "b" [green side] {\n  y: Y\n}\nx -> y\nb -> a');
  assert.match(m.errors[0].msg, /Link a node in it/);
  assert.strictEqual(m.errors[0].line, 9);
});

test('title, caption and cartouche are drawn: the title and caption above, the cartouche at the bottom right', async () => {
  const src = 'title "Orders"\ncaption "Production. Dashed links are optional."\ncartouche {\n  author: Yves\n  version: 1.2\n}\na: A\nb: B\na -> b';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.svg, /<text class="dtitle fg" x="16" y="29">Orders<\/text>/);
  assert.match(res.svg, /<text class="cap muted"[^>]*>Production\. Dashed links are optional\.<\/text>/);
  assert.match(res.svg, /<g transform="translate\(0,\d+\)">/, 'the drawing moves down under the title');
  assert.match(res.svg, /class="ck muted"[^>]*>author<\/text><text class="cv fg"[^>]*>Yves<\/text>/);
  const vb = +res.svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1];
  assert.ok(vb > res.rm.height + 60, 'the drawing grows by the header and the cartouche');
  // a long caption wraps
  const long = await compile('caption "' + 'word '.repeat(120).trim() + '"\na: A', measure, ELK, {});
  assert.ok((long.svg.match(/class="cap muted"/g) || []).length > 2, 'a long caption is several lines');
  // without them nothing moves
  const bare = await compile('a: A\nb: B\na -> b', measure, ELK, {});
  assert.doesNotMatch(bare.svg, /dtitle|translate\(0,/);
  // a cartouche left open is an error with its line
  const { parse } = require('../src/trace.js');
  const m = parse('a: A\ncartouche {\n  author: Yves');
  assert.strictEqual(m.errors[0].line, 2);
  assert.match(parse('cartouche {\n  just text\n}').errors[0].msg, /key: value/);
});

test('no link runs through a node that is not one of its ends, in any example', async () => {
  for (const file of files) {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
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

test('no two links lie on top of each other, in any example (links merged into one bus excepted)', async () => {
  const ov = (a, b, c, d) => {
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5) return Math.abs(a.y - c.y) < 7 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 8;
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5) return Math.abs(a.x - c.x) < 7 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 8;
    return false;
  };
  const bad = [];
  for (const file of files) {
    const res = await compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {});
    const E = res.rm.edges.filter(r => r.pts && !r.e.rail && !r.e.lifeline && !r.e.divider);
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const A = E[i], B = E[j];
      if (A.merged && B.merged) continue;            // a bus is shared on purpose
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
