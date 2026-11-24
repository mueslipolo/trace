// Approximate text measurement for Node, where there is no canvas.
// The browser uses real canvas measurement; this table is close to Inter's advance widths,
// good enough for snapshots and tests. Roadmap: replace with real font metrics (see docs/roadmap.md).
const NARROW = new Set("iljI.,:;'|!()[]{}/\\ ".split(''));
const WIDE = new Set('mwMW@%'.split(''));
function charEm(c) {
  if (NARROW.has(c)) return 0.3;
  if (WIDE.has(c)) return 0.86;
  if (c >= 'A' && c <= 'Z') return 0.68;
  if (c >= '0' && c <= '9') return 0.6;
  return 0.55;
}
function measure(text, font) {
  const m = /(\d+)\s+([\d.]+)px/.exec(font);
  const weight = m ? +m[1] : 400, size = m ? +m[2] : 12;
  let em = 0;
  for (const c of String(text)) em += charEm(c);
  return em * size * (weight >= 600 ? 1.05 : 1);
}
module.exports = { measure };
