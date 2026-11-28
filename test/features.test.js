// One test per feature or engine rule, on small scenarios (test/fixtures/) or on the cases.
const test = require('node:test');
const assert = require('node:assert');
const { fs, path, ELK, compile, parse, FONT_NOTE, measure, root, files, overlap, owns, readFx, frameBox, within, noOverlap, compileFile } = require('./helpers.js');

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
  const res = await compileFile('examples/cases/dmz.trace');
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
  // they are joined ([join] on the SIEM): one carries the label, and it is clear of every firewall
  const labelled = taps.filter(t => t.lab);
  assert.strictEqual(labelled.length, 1);
  for (const t of labelled) for (const id of ['fw1', 'fw2', 'fw3']) { const n = res.rm.nodes.find(x => x.id === id); assert.ok(t.lab.x - t.e.lab.w / 2 >= n.x + n.w - 1, 'the log label is clear of the firewalls'); }
  // a step's label is above the step, not on it
  const step = res.rm.edges.find(r => r.e.a === 'api1' && r.e.b === 'fw3');
  const ys = step.pts.filter((p, i) => i && Math.abs(p.y - step.pts[i - 1].y) < 0.5 && Math.abs(p.x - step.pts[i - 1].x) > 1).map(p => p.y);
  assert.ok(ys.length === 1 && step.lab.y + step.e.lab.h <= ys[0], 'the label sits above the horizontal step');
});

test('a label moves off a link that crosses it, and may wrap to two lines to fit', async () => {
  // b -> c runs right past a -> d's label unless that label moves
  const src = ['direction down', 'a: A', 'b: B', 'c: C', 'd: D', 'a -> d : a fairly long label for this link', 'b -> c : another'].join('\n');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const wide = await compile(['direction down', 'a: A', 'b: B', 'a -> b : 8443/tcp admins only', 'a -> b [dashed] : second'].join('\n'), measure, ELK, {});
  assert.deepStrictEqual(wide.errors, []);
});

test('mermaid-to-trace: shapes, both label forms, notes after a line break, subgraphs and padding subgraphs', () => {
  const { convert } = require('../tools/mermaid-to-trace.js');
  const out = convert([
    'flowchart LR',
    '  subgraph pad [ ]',
    '    style pad fill:none,stroke:none',
    '    subgraph c1[Cluster]',
    '      api["API<br/>Go"] -- calls --> db[(Postgres)]',
    '    end',
    '  end',
    '  user([User]) -.->|uses| api',
    '  api --> x.y',
  ].join('\n'));
  assert.match(out, /frame c1 "Cluster" \{/);
  assert.doesNotMatch(out, /frame pad/, 'a padding subgraph is not a frame');
  assert.match(out, /api: API \| Go/);
  assert.match(out, /store db: Postgres/);
  assert.match(out, /pill user: User/);
  assert.match(out, /^api -> db : calls$/m, 'a solid link stays solid even when its label holds a dot');
  assert.match(out, /^user --> api : uses$/m);
  assert.match(out, /^api -> x\.y$/m);
  assert.doesNotMatch(out, /direction down/);
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
  const res = await compileFile('examples/cases/office.trace');
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

test('hub: links between one node and five or more members of a zone it is not in meet at a bar inside the zone; one link crosses its edge', async () => {
  for (const f of ['examples/cases/hub.trace', 'examples/cases/simple/hub.trace']) {
    const res = await compile(fs.readFileSync(path.join(root, f), 'utf8'), measure, ELK, {});
    assert.deepStrictEqual(res.errors, []);
    const zone = res.rm.frames.find(z => z.f.id === 'services');
    const bars = res.rm.nodes.filter(n => n.kind === 'junction');
    assert.strictEqual(bars.length, 2, `${f}: one bar for the identity provider, one for the gateway`);
    for (const j of bars) assert.ok(j.x > zone.x && j.x + j.w < zone.x + zone.w && j.y > zone.y && j.y + j.h < zone.y + zone.h, `${f}: ${j.id} inside the services zone`);
    const into = res.rm.edges.filter(r => r.e.b === 'idp' && bars.some(j => j.id === r.e.a));
    assert.strictEqual(into.length, 1, `${f}: one link from the services to the identity provider`);
    assert.strictEqual(res.rm.edges.filter(r => r.e.a === 'gw' && bars.some(j => j.id === r.e.b)).length, 1, `${f}: one link from the gateway into the services`);
    for (const j of bars) {
      const mine = res.rm.edges.filter(r => (r.e.a === j.id || r.e.b === j.id) && !r.e.trunk);
      // every link meets the bar on its long side, each at its own place, 10px or more apart
      const at = mine.map(r => { const p = r.e.a === j.id ? r.pts[0] : r.pts[r.pts.length - 1]; assert.ok(p.y >= j.y - 0.5 && p.y <= j.y + j.h + 0.5, `${f}: ${r.e.a} -> ${r.e.b} meets the bar`); return p.y; }).sort((u, v) => u - v);
      for (let k = 1; k < at.length; k++) assert.ok(at[k] - at[k - 1] >= 9.5, `${f}: two links meet ${j.id} ${at[k] - at[k - 1]}px apart`);
    }
  }
  // four links are not enough
  const few = await compile('h: H\nframe z "z" {\n  a: A\n  b: B\n  c: C\n  d: D\n}\na -> h : x\nb -> h : x\nc -> h : x\nd -> h : x', measure, ELK, {});
  assert.ok(!few.rm.nodes.some(n => n.kind === 'junction'));
});

test('links leaving one short side of a node share the room out; stretches of different links are not squeezed together (aws case)', async () => {
  const res = await compileFile('examples/cases/aws.trace');
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
  const k8s = await compileFile('examples/cases/k8s.trace');
  assert.ok(k8s.rm.width / k8s.rm.height > 4, 'k8s stays a strip rather than get a link that runs the width of the page');
  try { } finally { delete process.env.TRACE_NOFOLD; }
});

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

test('title, caption and title block are drawn: the title and caption above, the title block at the bottom right', async () => {
  const src = 'title "Orders"\ncaption "Production. Dashed links are optional."\ntitle-block {\n  author: Yves\n  version: 1.2\n}\na: A\nb: B\na -> b';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.svg, /<text class="dtitle fg" x="16" y="29">Orders<\/text>/);
  assert.match(res.svg, /<text class="cap muted"[^>]*>Production\. Dashed links are optional\.<\/text>/);
  assert.match(res.svg, /<g transform="translate\(0,\d+\)">/, 'the drawing moves down under the title');
  assert.match(res.svg, /class="ck muted"[^>]*>author<\/text><text class="cv fg"[^>]*>Yves<\/text>/);
  const vb = +res.svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1];
  assert.ok(vb > res.rm.height + 60, 'the drawing grows by the header and the title block');
  // a long caption wraps
  const long = await compile('caption "' + 'word '.repeat(120).trim() + '"\na: A', measure, ELK, {});
  assert.ok((long.svg.match(/class="cap muted"/g) || []).length > 2, 'a long caption is several lines');
  // without them nothing moves
  const bare = await compile('a: A\nb: B\na -> b', measure, ELK, {});
  assert.doesNotMatch(bare.svg, /dtitle|translate\(0,/);
  // a title block left open is an error with its line
  const { parse } = require('../src/trace.js');
  const m = parse('a: A\ntitle-block {\n  author: Yves');
  assert.strictEqual(m.errors[0].line, 2);
  assert.match(parse('title-block {\n  just text\n}').errors[0].msg, /key: value/);
});

test('layout blocks hold even when every straight way into a frame member is blocked; the router takes the link round', async () => {
  const res = await compileFile('test/fixtures/blocked-port.trace');
  assert.deepStrictEqual(res.errors, []);
  assert.ok(!(res.rm.notes || []).some(n => /could not be placed/.test(n)), 'the rows and columns are kept');
  for (const r of res.rm.edges) for (const n of res.rm.nodes) {
    if (!r.pts || n.x === undefined || n.id === r.e.a || n.id === r.e.b) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      assert.ok(!(Math.min(a.x, b.x) < n.x + n.w - 1 && n.x + 1 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h - 1 && n.y + 1 < Math.max(a.y, b.y)), `${r.e.a} -> ${r.e.b} runs through ${n.id}`);
    }
  }
});

test('zones side by side in a row share their top, same-height makes them equal, and no zone covers another', async () => {
  const res = await compileFile('test/fixtures/row-zones.trace');
  assert.deepStrictEqual(res.errors, []);
  assert.ok(!(res.rm.notes || []).length, String(res.rm.notes));
  const F = id => res.rm.frames.find(f => f.f.id === id);
  const row = ['edge', 'web', 'flags'].map(F);
  for (const f of row) {
    assert.ok(Math.abs(f.y - row[0].y) < 0.5, `${f.f.id} starts at ${f.y}, ${row[0].f.id} at ${row[0].y}`);
    assert.ok(Math.abs(f.h - row[0].h) < 0.5, `${f.f.id} is ${f.h} tall, ${row[0].f.id} ${row[0].h}`);
  }
  const fr = res.rm.frames;
  for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) {
    const a = fr[i], b = fr[j];
    assert.ok(!overlap(a, b), `${a.f.id} and ${b.f.id} overlap`);
  }
});

test('mark: the links into the node are not drawn; each source carries its icon, in the zone ink, and the legend says what it means', async () => {
  const src = fs.readFileSync(path.join(root, 'examples/features/mark.after.trace'), 'utf8');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.ok(!res.rm.edges.some(r => r.e.b === 'flagd' || r.e.a === 'flagd'), 'no link into flagd is drawn');
  assert.strictEqual((res.svg.match(/class="mki ink-purple"/g) || []).length, 5 + 1, 'five marked nodes and the legend');
  assert.match(res.svg, /reads its feature flags from Flagd/);
  const plain = await compile(src.replace(/^mark .*$/m, ''), measure, ELK, {});
  const w = id => res.rm.nodes.find(n => n.id === id).w - plain.rm.nodes.find(n => n.id === id).w;
  assert.ok(w('orders') > 0, 'a marked node grows to hold the icon');
  assert.strictEqual(w('db'), 0, 'an unmarked node keeps its size');
});

test('mark: a marked node with no link left to draw stands at the end of the flow, not among the first nodes', async () => {
  const res = await compileFile('examples/cases/monorepo.trace');
  const N = id => res.rm.nodes.find(n => n.id === id);
  const last = Math.max(...res.rm.nodes.filter(n => !['utils', 'types'].includes(n.id)).map(n => n.x));
  for (const id of ['utils', 'types']) assert.ok(N(id).x >= last - 1, `${id} at x ${N(id).x}, the last column is at ${last}`);
});

test('mark: errors say what to write', () => {
  const err = src => (parse(src).errors[0] || {}).msg || '';
  assert.match(err('a: A\nb: B\na -> b\nmark nope "x"'), /no node called "nope"/);
  assert.match(err('a: A\nb: B\na -> b\nmark b "uses b"'), /needs an icon.*mark b \[flag\]/);
  assert.match(err('a: A\nb [flag]: B\nb -> a\nmark b "uses b"'), /no link arrives there/);
  assert.match(err('a: A\nb [flag]: B\na -> b\nmark b'), /needs the words for the legend/);
  assert.match(err('frame f "F" {\n  a: A\n}\nb: B\nb -> a\nmark f [flag] "x"'), /takes a node, not a frame/);
  assert.match(err('a: A\nb [flag]: B\na -> b\nmark b [nosuchicon] "x"'), /no icon called "nosuchicon"/);
  assert.deepStrictEqual(parse('mark: Mark\nmark -> b').errors, [], 'a node called mark still works');
});

test('logos: beside the technology name with a role icon, in its place without one, before a zone title; errors say what to write', async () => {
  const res = await compileFile('test/fixtures/logos.trace');
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.warnings, []);
  const N = id => res.rm.nodes.find(n => n.id === id);
  assert.ok(N('pg').logoSmall && N('pg').note === 'PostgreSQL', 'a node with a role icon and no note gets the technology name as its note');
  assert.ok(N('cache').logoSmall && N('cache').note === 'Redis · sessions, 1 h', 'a note of its own comes after the technology name');
  assert.ok(N('api').logoMain, 'no role icon: the logo takes its place');
  assert.ok(N('events').logoSmall && N('events').note === 'Apache Kafka', 'kafka is the short name of apachekafka');
  assert.strictEqual((res.svg.match(/class="logo-soft"/g) || []).length, 6 + 1, 'six small logos and the zone');
  assert.strictEqual((res.svg.match(/class="logo"/g) || []).length, 2, 'two logos in the icon place');
  // the logo and its text fit in the box
  for (const n of res.rm.nodes.filter(n => n.logoSmall)) assert.ok(measure(n.noteLines[0], FONT_NOTE) + 15 <= n.w - 2 * n.padX - 30 + 0.5, `${n.id}: the note and its logo fit`);
  const err = src => (parse(src).errors[0] || {}).msg || '';
  assert.match(err('a [postgresqll]: A'), /technology such as postgresql/);
  assert.deepStrictEqual(parse('a [vault]: A').errors, [], 'vault is a Lucide icon');
  assert.strictEqual(parse('a [vault]: A').nodes.get('a').icon, 'vault');
  assert.strictEqual(parse('a [logo/vault]: A').nodes.get('a').logo, 'logo/vault');
  assert.strictEqual(parse('frame f "F" [orange] {\n  a: A\n}').frames.get('f').tags[0], 'orange', 'orange stays a colour');
});

test('zones stacked in a column share their left edge (hybrid: the three subnets), and same-width then gives them straight sides', async () => {
  const res = await compileFile('examples/cases/hybrid.trace');
  assert.deepStrictEqual(res.errors, []);
  const F = id => res.rm.frames.find(f => f.f.id === id);
  const subnets = ['pub', 'priv', 'dbs'].map(F);
  for (const f of subnets) {
    assert.ok(Math.abs(f.x - subnets[0].x) < 0.5, `${f.f.id} starts at ${f.x}, ${subnets[0].f.id} at ${subnets[0].x}`);
    assert.ok(Math.abs(f.w - subnets[0].w) < 0.5, `${f.f.id} is ${f.w} wide`);
  }
});

test('links into one table row that look the same meet at one point; links that look different keep their own places', async () => {
  const shop = await compileFile('examples/cases/shop-model.trace');
  const ends = shop.rm.edges.filter(r => r.e.b === 'customers' && r.e.bCol === 'id').map(r => r.pts[r.pts.length - 1]);
  assert.ok(ends.length >= 3);
  for (const p of ends) assert.ok(Math.abs(p.x - ends[0].x) < 0.5 && Math.abs(p.y - ends[0].y) < 0.5, 'one point on customers.id');
  const dm = await compileFile('examples/playground/data-model.trace');
  const ys = dm.rm.edges.filter(r => r.e.b === 'orders' && r.e.bCol === 'id').map(r => Math.round(r.pts[r.pts.length - 1].y));
  assert.strictEqual(new Set(ys).size, ys.length, 'different marks and styles on orders.id keep their own places');
});

test('a decision sends its two outcomes out of different sides, each with its label', async () => {
  const res = await compileFile('examples/cases/triage.trace');
  const side = (r, n) => { const p = r.pts[0]; return Math.abs(p.y - n.y - n.h) < 2 ? 'bottom' : Math.abs(p.y - n.y) < 2 ? 'top' : Math.abs(p.x - n.x) < 2 ? 'left' : 'right'; };
  for (const id of ['spam', 'known', 'urgent']) {
    const n = res.rm.nodes.find(m => m.id === id);
    const out = res.rm.edges.filter(r => r.e.a === id);
    assert.strictEqual(new Set(out.map(r => side(r, n))).size, 2, `${id}: yes and no leave from different sides`);
    assert.ok(out.every(r => r.lab), `${id}: both keep their label`);
  }
});

test('tree: a hierarchy (a tree with no decisions) puts each parent in the middle of its children, only when asked for; a decision tree keeps its straight path', async () => {
  const res = await compileFile('examples/cases/orgchart.trace');
  const N = id => res.rm.nodes.find(n => n.id === id), c = n => n.x + n.w / 2;   // the case is top-down
  for (const [p, kids] of [['cto', ['platform', 'security']], ['cfo', ['finance', 'legal']], ['coo', ['support', 'ops']]]) {
    const lo = c(N(kids[0])), hi = c(N(kids[1])), mid = (lo + hi) / 2;
    assert.ok(Math.abs(c(N(p)) - mid) <= (hi - lo) / 4 + 1, `${p} in the middle half of its children (${c(N(p))}, children ${lo} to ${hi})`);
  }
  // only when asked for: the same chart without the line tree is drawn as usual
  const plain = await compile(fs.readFileSync(path.join(root, 'examples/cases/orgchart.trace'), 'utf8').replace(/^tree\n/m, ''), measure, ELK, {});
  assert.ok(!plain.rm.edges.some(r => r.merged), 'no org-chart bars without the line tree');
  // zones round a tree are fine (Ingress fan-out, top-down): each service over its pods, inside the cluster
  const ing = await compile(fs.readFileSync(path.join(root, 'examples/holdout/k8s-ingress-fanout.trace'), 'utf8').replace(/^title.*$/m, '$&\ndirection down\ntree'), measure, ELK, {});
  const I = id => ing.rm.nodes.find(n => n.id === id);
  for (const [p, a, b] of [['service1', 'pod1', 'pod2'], ['service2', 'pod3', 'pod4']]) { const lo = Math.min(c(I(a)), c(I(b))), hi = Math.max(c(I(a)), c(I(b))); assert.ok(Math.abs(c(I(p)) - (lo + hi) / 2) <= (hi - lo) / 4 + 1, `${p} over the middle of its pods`); }
  const notTree = await compile('tree\na -> b\nb -> a\nc -> a\nd -> c\n', measure, ELK, {});
  assert.ok(notTree.warnings.some(w => /^tree:/.test(w)), 'a warning when the diagram is not a hierarchy');
  const who = await compileFile('examples/playground/who-may-delete-audit-rows.trace');
  assert.ok(who.rm.edges.some(r => r.e.label === 'yes' && r.pts.length === 2), 'the decision tree keeps a straight yes');
});

test('gather: links into a node tagged gather meet one line with a dot, from two links up; without the tag they stay apart', async () => {
  const src = fs.readFileSync(path.join(root, 'examples/features/join.after.trace'), 'utf8');
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const into = res.rm.edges.filter(r => r.e.b === 'gate');
  assert.strictEqual(into.length, 3);
  assert.ok(into.every(r => r.merged && r.mergeHub === 'gate'), 'the three checks are joined');
  assert.ok(res.rm.joins.length >= 1, 'a dot where they meet');
  const plain = await compile(src.replace(' [gather]', ''), measure, ELK, {});
  assert.ok(!plain.rm.edges.some(r => r.merged), 'three links alone are not joined');
});

test('join: a zone border beside another row does not stop a bus (CI/CD gate, DMZ SIEM)', async () => {
  for (const [f, hub, from] of [['cicd', 'gate', ['unit', 'lint', 'sast']], ['dmz', 'siem', ['fw1', 'fw2', 'fw3']]]) {
    const res = await compile(fs.readFileSync(path.join(root, `examples/cases/${f}.trace`), 'utf8'), measure, ELK, {});
    const into = res.rm.edges.filter(r => r.e.b === hub && from.includes(r.e.a));
    assert.strictEqual(into.length, 3);
    assert.ok(into.every(r => r.merged), `${f}: the links into ${hub} are joined`);
  }
});

test('side zones: zones written the same width in the main flow keep a common left edge, and the side zone stands level with them', async () => {
  const res = await compileFile('test/fixtures/side-same-width.trace');
  assert.deepStrictEqual(res.errors, []);
  const f = id => res.rm.frames.find(x => x.f.id === id);
  const xs = ['edge', 'core', 'access'].map(id => f(id).x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 1, `edge, core and access line up on the left (${xs.map(Math.round)})`);
  const sec = f('sec'), access = f('access'), edge = f('edge');
  assert.ok(sec.y < access.y + access.h && sec.y + sec.h > edge.y, 'the side zone is beside the tiers, not below them');
  assert.ok(sec.x + sec.w < Math.min(...xs), 'and on their left');
});

test('zones that ELK puts side by side in one layer share their top (per-zone layout; OTel telemetry backends)', async () => {
  const was = process.env.TRACE_LAYOUT;
  process.env.TRACE_LAYOUT = 'hier';
  try {
    const res = await compileFile('examples/holdout/otel-telemetry.trace');
    const tops = ['op', 'pr', 'ja', 'os'].map(id => res.rm.frames.find(f => f.f.id === id).y);
    assert.ok(Math.max(...tops) - Math.min(...tops) < 1, `the four backends share their top (${tops.map(Math.round)})`);
  } finally { if (was === undefined) delete process.env.TRACE_LAYOUT; else process.env.TRACE_LAYOUT = was; }
});

test('arrowheads at the start of a link use their own marker with orient="auto" (PNG renderers lack auto-start-reverse)', async () => {
  const res = await compile('a -> b\nc <- d\n', measure, ELK, {});
  assert.ok(!/auto-start-reverse/.test(res.svg));
  assert.match(res.svg, /marker-start="url\(#[^)]*s\)"/);
});

test('no link label straddles a zone border where it has another place (techtribes, full)', async () => {
  const res = await compileFile('examples/holdout/full/techtribes.trace');
  for (const r of res.rm.edges.filter(r => r.lab && r.e.lab)) {
    const w = r.e.lab.w, x0 = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x;
    for (const f of res.rm.frames) {
      const inY = r.lab.y < f.y + f.h && f.y < r.lab.y + r.e.lab.h;
      assert.ok(!(inY && [f.x, f.x + f.w].some(v => x0 + 2 < v && v < x0 + w - 2)), `"${r.e.label}" crosses the border of ${f.f.id}`);
    }
  }
});

test('same-width holds after a zone grows for its title: its partners grow with it, inside their zone (Deployment, full)', async () => {
  const res = await compileFile('examples/holdout/full/bigbank-deployment.trace');
  const f = id => res.rm.frames.find(x => x.f.id === id);
  assert.ok(Math.abs(f('dn').w - f('bb2').w) < 1, 'dn and bb2 are as wide');
  const dc = res.rm.frames.find(x => f('dn').x > x.x && f('dn').x + f('dn').w < x.x + x.w && x !== f('dn') && x.w > f('dn').w + f('bb2').w);
  assert.ok(dc && f('bb2').x >= dc.x, 'bb2 stays inside the data center');
});

test('align: the drawing keeps no blank band, and nothing it moves goes past the left edge', async () => {
  const ent = fs.readFileSync(path.join(root, 'examples/holdout/full/enterprise-context.trace'), 'utf8');
  const a = await compile(ent, measure, ELK, {}), b = await compile(ent + '\nalign fulfillment post\n', measure, ELK, {});
  assert.ok(b.rm.height <= a.rm.height + 1, `aligning does not make the drawing taller (${Math.round(a.rm.height)} -> ${Math.round(b.rm.height)})`);
  const con = fs.readFileSync(path.join(root, 'examples/holdout/full/bigbank-container.trace'), 'utf8')
    .replace(/row \{\n  (pill customer[^\n]*)\n  (engine email[^\n]*)\n\}/, '$1\n$2') + '\nalign customer email\n';
  const c = await compile(con, measure, ELK, {});
  assert.ok(c.rm.nodes.every(n => n.x === undefined || n.x >= 15.5), 'no node past the left edge');
});

test('align: a zone that slides takes the nodes that hang from it alone (the Grafana browser follows Grafana)', async () => {
  const src = fs.readFileSync(path.join(root, 'examples/holdout/full/otel-telemetry.trace'), 'utf8') + '\nalign os-http gr-srv\n';
  const res = await compile(src, measure, ELK, {});
  const n = id => res.rm.nodes.find(x => x.id === id);
  assert.ok(Math.abs((n('gr-http').x + n('gr-http').w / 2) - (n('gr-b').x + n('gr-b').w / 2)) < 1, 'the browser stays under Grafana HTTP');
});

test('a link that ELK sends through nodes is routed round them, even alongside another link (a row of zones in a column)', async () => {
  const res = await compileFile('test/fixtures/row-in-column-through.trace');
  const N = res.rm.nodes.filter(n => n.x !== undefined);
  for (const r of res.rm.edges) for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i];
    for (const n of N) if (n.id !== r.e.a && n.id !== r.e.b) assert.ok(!(Math.min(a.x, b.x) < n.x + n.w - 1 && n.x + 1 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h - 1 && n.y + 1 < Math.max(a.y, b.y)) || (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5), `${r.e.a} -> ${r.e.b} runs through ${n.id}`);
  }
});

test('labels: a name, note or link label written whole in quotes loses them (to write a # or a |); "" is a zone with no title', () => {
  const m = parse('a: "Flex Mini #1" | "5-port #A"\nb: say "hi"\na -> b : "port #2"\nframe z "" [grey] {\n  c\n}\nframe y [grey] {\n  d\n}\n');
  assert.deepStrictEqual([m.nodes.get('a').name, m.nodes.get('a').note, m.nodes.get('b').name], ['Flex Mini #1', '5-port #A', 'say "hi"']);
  assert.strictEqual(m.edges[0].label, 'port #2');
  assert.strictEqual(m.frames.get('z').title, '');
  assert.strictEqual(m.frames.get('y').title, 'y');
});

test('mermaid-to-trace: a link to a subgraph links the zone (no node of that name); a # or | in a label is quoted', async () => {
  const { convert } = require('../tools/mermaid-to-trace.js');
  const out = convert('flowchart TD\n  r[Router] --> sw[Flex Mini #1]\n  r --> W\n  subgraph W[Wi-Fi]\n    a[AP 1]\n  end\n  sw -->|port #2| a\n', 'T');
  assert.match(out, /sw: "Flex Mini #1"/);
  assert.match(out, /sw -> a : "port #2"/);
  assert.ok(!/^\s*W:/m.test(out), 'no node W');
  const res = await compile(out, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.model.nodes.get('sw').name, 'Flex Mini #1');
});

test('zones in a row put their titles on the same edge, with their bottoms lined up (UniFi home network)', async () => {
  const res = await compileFile('examples/holdout/unifi-home-vlans.trace');
  const row = ['VLAN65W2', 'VLAN62', 'VLAN1W2', 'VLAN64W', 'VLAN1W', 'VLAN65W'].map(id => res.rm.frames.find(f => f.f.id === id));
  assert.ok(row.every(f => f.titleEdge === 'bottom'), 'every title at the bottom');
  const bots = row.map(f => f.y + f.h);
  assert.ok(Math.max(...bots) - Math.min(...bots) < 1, 'bottoms lined up');
});

test('a node reached from inside a zone stands beside it, level with what links to it, its links straight (eShop, OpenAI)', async () => {
  const res = await compileFile('examples/holdout/full/eshop.trace');
  const n = id => res.rm.nodes.find(x => x.id === id), cloud = res.rm.frames.find(f => f.f.id === 'cloud');
  assert.ok(n('openai').y > cloud.y + 40, 'OpenAI is not above the cloud zone');
  for (const r of res.rm.edges.filter(r => r.e.b === 'openai')) {
    const L = r.pts.length, a = r.pts[L - 2], b = r.pts[L - 1];
    assert.ok(Math.abs(a.y - b.y) < 0.5 && Math.abs(b.x - n('openai').x) < 1, `${r.e.a} -> openai ends straight on its side`);
  }
});

test('links to zones: rows and columns of zones still work, and a link to a zone ends on its border (multi-region SaaS)', async () => {
  const res = await compileFile('examples/holdout/full/multi-region-saas.trace');
  assert.deepStrictEqual(res.warnings, [], 'no "could not be placed" note');
  const f = id => res.rm.frames.find(x => x.f.id === id);
  const tops = ['eu', 'shared', 'us'].map(id => f(id).y);
  assert.ok(Math.max(...tops) - Math.min(...tops) < 1, 'the regions and the shared zone in one row');
  for (const k of ['euk8s', 'usk8s']) {
    const r = res.rm.edges.find(e => e.e.a === 'cicd' && e.e.b === k), z = f(k), p = r.pts[r.pts.length - 1];
    const onBorder = (Math.abs(p.x - z.x) < 2 || Math.abs(p.x - z.x - z.w) < 2) && p.y >= z.y && p.y <= z.y + z.h || (Math.abs(p.y - z.y) < 2 || Math.abs(p.y - z.y - z.h) < 2) && p.x >= z.x && p.x <= z.x + z.w;
    assert.ok(onBorder, `cicd -> ${k} ends on the zone's border`);
  }
});

test('UniFi home network: zones in one layer share their top in every layout, and a span node lets a link leave past its stack (no hop)', async () => {
  const res = await compileFile('examples/holdout/full/unifi-home-vlans.trace');
  const f = id => res.rm.frames.find(x => x.f.id === id);
  assert.ok(Math.abs(f('CORE').y - f('WIFI').y) < 1, 'Core switching and Wi-Fi share their top');
  const hue = res.rm.edges.find(e => e.e.b === 'HUE');
  const others = res.rm.edges.filter(e => e !== hue && e.pts);
  const crossesAny = others.some(o => hue.pts.some((p, i) => i && o.pts.some((q, j) => j && (() => {
    const a = hue.pts[i - 1], c = o.pts[j - 1], h1 = Math.abs(a.y - p.y) < 0.5, h2 = Math.abs(c.y - q.y) < 0.5;
    if (h1 === h2) return false;
    const [H0, H1, V0, V1] = h1 ? [a, p, c, q] : [c, q, a, p];
    return Math.min(H0.x, H1.x) + 0.5 < V0.x && V0.x < Math.max(H0.x, H1.x) - 0.5 && Math.min(V0.y, V1.y) + 0.5 < H0.y && H0.y < Math.max(V0.y, V1.y) - 0.5;
  })())));
  assert.ok(!crossesAny, 'the link to the Hue bridge crosses nothing');
});

test('gather: five alike links make a bus by default, gather N changes the number, gather off stops it', async () => {
  const src = n => ['direction right', 'idp: Identity provider', ...Array.from({ length: n }, (_, i) => `s${i} -> idp : validate token`)].join('\n');
  const merged = async s => (await compile(s, measure, ELK, {})).rm.edges.filter(r => r.merged).length;
  assert.strictEqual(await merged(src(4)), 0, 'four links stay apart by default');
  assert.strictEqual(await merged(src(5)), 5, 'five links make a bus');
  assert.strictEqual(await merged('gather 4\n' + src(4)), 4, 'gather 4 makes a bus of four');
  assert.strictEqual(await merged('gather off\n' + src(6)), 0, 'gather off keeps them apart');
  const bad = await compile('gather 1\n' + src(3), measure, ELK, {});
  assert.ok(bad.errors.some(e => /gather takes/.test(e.msg) && e.line === 1));
});

test('link labels: a tag puts the label near an end, three parts name both ends, a bad label says what to write', async () => {
  const src = 'direction down\na: Source\nb: Target\na -> b : 443/tcp [label-end]\nb -> c : eth0 | uplink | port 24';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const ab = res.rm.edges.find(r => r.e.a === 'a' && r.e.b === 'b'), B = res.rm.nodes.find(n => n.id === 'b');
  const end = ab.pts[ab.pts.length - 1], labMid = ab.lab.y + ab.e.lab.h / 2;
  assert.ok(Math.abs(labMid - end.y) < Math.abs(labMid - ab.pts[0].y), 'the label is nearer the target');
  assert.ok(labMid < B.y, 'and above it');
  const bc = res.rm.edges.find(r => r.e.a === 'b');
  assert.strictEqual(bc.e.label, 'uplink');
  assert.deepStrictEqual(bc.endLabs.map(x => x.size.lines[0]), ['eth0', 'port 24']);
  assert.ok(res.svg.includes('>eth0<') && res.svg.includes('>port 24<'));
  const bad = await compile('a -> b : one | two', measure, ELK, {});
  assert.ok(bad.errors.some(e => /three parts/.test(e.msg) && e.line === 1));
  const quoted = await compile('a -> b : "one | two"', measure, ELK, {});
  assert.deepStrictEqual(quoted.errors, []);
});

test('notes: in the margin when short, numbered when asked, never moving the drawing, and a wrong name says what to write', async () => {
  const base = 'pill client: Client\nframe pci "PCI" [blue] {\n  api: API\n  store db: Postgres\n}\nclient -> api\napi -> db';
  const notes = '\nnote db : read replica planned\nnote api -> db : pool of 20\nnote pci : audited yearly\nnote : load test numbers';
  const plain = await compile(base, measure, ELK, {}), margin = await compile(base + notes, measure, ELK, {});
  assert.deepStrictEqual(margin.errors, []);
  const pos = r => JSON.stringify(r.rm.nodes.map(n => [n.id, n.x, n.y]));
  assert.strictEqual(pos(margin), pos(plain), 'the layout is the same with notes');
  assert.strictEqual(margin.rm.annot.style, 'margin');
  assert.ok(margin.svg.includes('>read replica planned<') && margin.svg.includes('class="nline"'));
  assert.ok((margin.svg.match(/class="nnote"/g) || []).length === 4, 'each note is one group, for the hover effect');
  const numbered = await compile(base + notes + '\nnotes numbered', measure, ELK, {});
  assert.strictEqual(numbered.rm.annot.style, 'numbered');
  assert.strictEqual(numbered.rm.annot.items.filter(it => it.n).length, 3, 'three numbered, the whole-diagram note unnumbered');
  const bad = await compile(base + '\nnote nope : x', measure, ELK, {});
  assert.ok(bad.errors.some(e => /no node or zone called nope/.test(e.msg) && e.line === 8));
  const badLink = await compile(base + '\nnote client -> db : x', measure, ELK, {});
  assert.ok(badLink.errors.some(e => /no link between client and db/.test(e.msg)));
});

test('a bridge pairs its zone with the outermost zone across the border: zones side by side inside a zone stay inside it', async () => {
  const res = await compile(readFx('nested-bridge.trace'), measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const box = id => res.rm.frames.find(f => f.f.id === id);
  const app = box('app'), k8s = box('k8s'), vms = box('vms'), data = box('data');
  for (const z of [k8s, vms]) assert.ok(z.x >= app.x && z.y >= app.y && z.x + z.w <= app.x + app.w && z.y + z.h <= app.y + app.h, `${z.f.id} inside the application network`);
  assert.ok(Math.abs(data.y - (app.y + app.h)) < 2, 'the data zone meets the application network at the DB firewall');
  assert.ok(data.w > k8s.w + 40, 'the data zone is not cut to the width of the Kubernetes zone');
  // a link between two zones side by side enters its target from the side facing it, not through it
  const ob = res.rm.edges.find(r => r.e.a === 'orders' && r.e.b === 'billing'), billing = res.rm.nodes.find(n => n.id === 'billing');
  const end = ob.pts[ob.pts.length - 1];
  assert.ok(Math.abs(end.x - (billing.x + billing.w)) < 2, 'Orders reaches Billing on its right side');
});

test('[gather] on links gathers just those links from two up; on a node it is the new name of [join]', async () => {
  const src = 'direction right\nidp: Identity provider\na: A\nb: B\nc: C\na -> idp : token [gather]\nb -> idp : token [gather]\nc -> idp : login';
  const res = await compile(src, measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  const merged = res.rm.edges.filter(r => r.merged).map(r => r.e.a).sort();
  assert.deepStrictEqual(merged, ['a', 'b'], 'the two tagged links are one bus, the third stays apart');
  const node = await compile('direction right\nidp [gather]: Identity provider\na -> idp : token\nb -> idp : token', measure, ELK, {});
  assert.strictEqual(node.rm.edges.filter(r => r.merged).length, 2);
  const old = await compile('direction right\nidp [join]: Identity provider\na -> idp : token\nb -> idp : token', measure, ELK, {});
  assert.strictEqual(old.rm.edges.filter(r => r.merged).length, 2, '[join] still works');
});

test('an arrow inside a link label is drawn as written, with a warning that says how to label each step', async () => {
  const res = await compile('a -> b : one -> c', measure, ELK, {});
  assert.deepStrictEqual(res.errors, []);
  assert.ok(res.warnings.some(w => /Line 1: the label of this link contains an arrow/.test(w)));
  const quoted = await compile('a -> b : "one -> c"', measure, ELK, {});
  assert.ok(!quoted.warnings.some(w => /contains an arrow/.test(w)), 'no warning when the label is in quotes');
});

test('a zone title can be written like a node label, with a colon; the quoted form still works', () => {
  for (const src of ['frame dmz: DMZ, 10.0.1.0/24 [orange] {\n  a: A\n}', 'frame dmz [orange]: DMZ, 10.0.1.0/24 {\n  a: A\n}', 'frame dmz "DMZ, 10.0.1.0/24" [orange] {\n  a: A\n}']) {
    const m = parse(src);
    assert.deepStrictEqual(m.errors, [], src);
    const f = m.frames.get('dmz');
    assert.strictEqual(f.title, 'DMZ, 10.0.1.0/24', src);
    assert.deepStrictEqual(f.tags, ['orange'], src);
  }
});

test('icon-top puts the icon above the text, like its older name top', async () => {
  for (const t of ['icon-top', 'top']) {
    const res = await compile(`lb [loadbalancer ${t}]: Load balancer`, measure, ELK, {});
    assert.deepStrictEqual(res.errors, []);
    assert.ok(res.model.nodes.get('lb').iconTop, t);
  }
});

test('a dot in a name is kept for table columns: any other dotted name is an error that says what to write', () => {
  const m = parse('api.v2 -> db');
  assert.ok(m.errors.some(e => /no table called "api"/.test(e.msg) && /api-v2/.test(e.msg) && e.line === 1));
  const t = parse('table orders {\n  id uuid pk\n}\nx -> orders.id');
  assert.deepStrictEqual(t.errors, [], 'a table column still works');
});

test('link styles: ==> is the main path (thicker), -x and --x are refused (a cross at the target), only with spaces round them', async () => {
  const m = parse('a: A\nb: B\napp-xray: X\na ==> b : 443/tcp\nb -x a\nb --x app-xray [bad]\napp-xray -> a');
  assert.deepStrictEqual(m.errors, []);
  const tags = m.edges.map(e => [e.a, e.b, e.tags.join(' '), e.dashed]);
  assert.deepStrictEqual(tags, [['a', 'b', 'main', false], ['b', 'a', 'refused', false], ['b', 'app-xray', 'bad refused', true], ['app-xray', 'a', '', false]]);
  assert.strictEqual(m.edges[0].label, '443/tcp');
  const res = await compile('a: A\nb: B\nc: C\na ==> b\nb -x c [bad]', measure, ELK, {});
  assert.match(res.svg, /class="arrow main"[^>]*marker-end="url\(#[^)]*aM\)"/, 'a main link is thick, with a head of its own size');
  assert.match(res.svg, /class="arrow bad"[^>]*marker-end="url\(#[^)]*badX\)"/, 'a refused link ends in a cross of its colour');
  assert.match(res.svg, /<marker id="[^"]*badX"[^>]*><path d="M5 1 L13 9 M13 1 L5 9" class="xm head-bad"/);
});
