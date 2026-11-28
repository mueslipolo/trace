// What every test file uses: the engine, the text measure, the example files, a few geometry checks, and
// compileFile, which compiles each example file once per run and hands the same result to every test that asks
// (the tests read the results, none changes them).
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile, parse, FONT_NOTE } = require('../src/trace.js');
const { measure } = require('../tools/measure.js');

const root = path.join(__dirname, '..');
const files = ['playground', 'cases', 'cases/simple', 'holdout/full'].flatMap(g =>
  fs.readdirSync(path.join(root, 'examples', g)).filter(f => f.endsWith('.trace')).map(f => path.join('examples', g, f)));

const overlap = (a, b, m = 0) => a.x < b.x + b.w - m && b.x < a.x + a.w - m && a.y < b.y + b.h - m && b.y < a.y + a.h - m;
const owns = (frame, n) => { for (let p = n.parent; p; p = p.parent) if (p === frame) return true; return false; };
const readFx = n => fs.readFileSync(path.join(root, 'test/fixtures', n), 'utf8');
const frameBox = (res, id) => res.rm.frames.find(f => f.f.id === id);
const within = (res, b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= res.rm.width + 0.5 && b.y + b.h <= res.rm.height + 0.5;
const noOverlap = (res, a, b) => !(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1);

const cache = new Map();
const compileFile = file => {
  if (!cache.has(file)) cache.set(file, compile(fs.readFileSync(path.join(root, file), 'utf8'), measure, ELK, {}));
  return cache.get(file);
};

module.exports = { fs, path, ELK, compile, parse, FONT_NOTE, measure, root, files, overlap, owns, readFx, frameBox, within, noOverlap, compileFile };
