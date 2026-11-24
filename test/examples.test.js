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
const files = ['playground', 'cases'].flatMap(g =>
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
