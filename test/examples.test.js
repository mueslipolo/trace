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
  // the log links' labels are past the zones, between their borders and the bus
  const right = Math.max(...res.rm.frames.map(f => f.x + f.w));
  const taps = res.rm.edges.filter(r => r.e.b === 'logs' && r.e.a !== 'logs');
  assert.strictEqual(taps.length, 3);
  for (const t of taps) assert.ok(t.lab.x - t.e.lab.w / 2 >= right - 1, 'a rail label is clear of the zones');
  // a step's label is above the step, not on it
  const step = res.rm.edges.find(r => r.e.a === 'api1' && r.e.b === 'fw3');
  const ys = step.pts.filter((p, i) => i && Math.abs(p.y - step.pts[i - 1].y) < 0.5 && Math.abs(p.x - step.pts[i - 1].x) > 1).map(p => p.y);
  assert.ok(ys.length === 1 && step.lab.y + step.e.lab.h <= ys[0], 'the label sits above the horizontal step');
});
