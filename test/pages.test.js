// The pages (playground, showcase, features, comparison), the docs and their pictures, and the simple forms of the cases.
const test = require('node:test');
const assert = require('node:assert');
const { fs, path, ELK, compile, parse, FONT_NOTE, measure, root, files, overlap, owns, readFx, frameBox, within, noOverlap, compileFile } = require('./helpers.js');

test('each simple case is the full case with the advanced commands removed (npm run simplify)', () => {
  const { simplify } = require('../tools/simplify.js');
  const dir = path.join(root, 'examples', 'cases');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.trace'))) {
    const want = simplify(fs.readFileSync(path.join(dir, f), 'utf8')).text;
    const have = fs.readFileSync(path.join(dir, 'simple', f), 'utf8');
    assert.strictEqual(have, want, `examples/cases/simple/${f} is out of date: run npm run simplify`);
  }
});

test('the comparison page is built with every Trace drawing already in it (no engine in the page), Mermaid drawn live', () => {
  const { execFileSync } = require('child_process');
  const out = path.join(require('os').tmpdir(), 'trace-compare-test.html');
  execFileSync('node', [path.join(root, 'tools/build-compare.js'), '--out', out], { stdio: 'pipe' });
  const html = fs.readFileSync(out, 'utf8');
  const CASES = JSON.parse(html.match(/const CASES = (\[.*?\]);\n/s)[1]);
  const ids = fs.readdirSync(path.join(root, 'examples/holdout')).filter(f => f.endsWith('.trace'));
  assert.strictEqual(CASES.length, ids.length);
  for (const c of CASES) { assert.match(c.svg, /^<svg/, `${c.id} drawn`); if (c.full) assert.match(c.fsvg, /^<svg/, `${c.id} full drawn`); }
  assert.ok(!/elkjs|function compile/.test(html), 'no layout engine in the page');
  assert.match(html, /mermaid@11\.17\.2/);
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

test('the comparison page draws every held-out diagram with Trace and Mermaid, each with its Mermaid version', () => {
  const { execFileSync } = require('child_process');
  execFileSync('node', [path.join(root, 'tools/build-compare.js')], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(root, 'dist/compare.html'), 'utf8');
  const dir = path.join(root, 'examples/holdout');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.trace'))) {
    const id = f.replace(/\.trace$/, '');
    assert.ok(fs.existsSync(path.join(dir, id + '.mmd')), `${id}.mmd next to ${f}`);
    assert.match(html, new RegExp(`<li><a href="#${id}">`), `${id} in the list`);
  }
  assert.match(html, /mermaid@\d+\.\d+\.\d+\/dist\/mermaid\.min\.js/, 'Mermaid pinned to a version');
  assert.match(html, /id="mcanvas"/);
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

test('sequence: a message label has a ground of the page colour, so lifelines it spans do not show through it', async () => {
  const res = await compileFile('examples/holdout/gitlab-ssh-fetch.trace');
  const labelled = res.rm.edges.filter(r => !r.e.lifeline && r.lab && r.e.lab).length;
  assert.ok(labelled > 0);
  assert.strictEqual((res.svg.match(/class="labbg"/g) || []).length, labelled);
});

test('every diagram in the docs shows its Trace source, up to date', () => {
  const { fill, docFiles } = require('../tools/doc-sources.js');
  for (const f of docFiles()) {
    const md = fs.readFileSync(path.join(root, f), 'utf8');
    assert.strictEqual(fill(md), md, `${f}: a source block is out of date: run npm run build:docs`);
    // a picture of a diagram (docs/images, not a .dark one) has a source block in the same file
    const pics = [...md.matchAll(/<img src="(?:docs\/)?images\/([\w.-]+)\.png"/g)].map(m => m[1]);
    if (pics.length) assert.ok(/<!-- source /.test(md), `${f}: pictures without a source block`);
  }
});

test('docs/how-it-works.md shows every step of the tidy-up, in the order the engine runs them', async () => {
  const names = [];
  const res = await compile('a -> b', measure, ELK, { onStage: (n, rm) => names.push(n) });
  const steps = names.slice(names.lastIndexOf('layout') + 1);
  const md = fs.readFileSync(path.join(root, 'docs/how-it-works.md'), 'utf8');
  const shown = [...md.matchAll(/<!-- step: (\w+) -->/g)].map(m => m[1]);
  assert.deepStrictEqual(shown, steps, 'a step was added, removed or moved: run npm run build:docs');
  const { STEPS } = require('../tools/build-algorithm.js');
  assert.deepStrictEqual(STEPS.map(s => s[0]), steps, 'tools/build-algorithm.js needs a caption for each step');
});
