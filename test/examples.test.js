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
    for (const fr of res.rm.frames) {
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
  assert.ok(bends(withCycle) < bends(without) * 0.8, `fewer bends when cycles are broken by declaration order (${bends(withCycle)} against ${bends(without)})`);
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
  assert.match(loose.warnings.join('|'), /only nodes in a row or column/);
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
