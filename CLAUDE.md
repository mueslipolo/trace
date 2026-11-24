# Trace

Trace is a small text language for diagrams. You write it like Mermaid; it is drawn like the
hand-laid-out SVGs in `reference/hand-drawn-svgs/`. Those SVGs are the target style and the
quality bar: when in doubt about how something should look, open them.

The project started in a claude.ai conversation. Everything decided there is captured in this
file and in `docs/`. Read `docs/language.md` before changing the parser, `docs/architecture.md`
before changing layout, and `docs/roadmap.md` before picking up work.

## Layout of the repository

- `src/trace.js`: the whole engine in one file: parser, layout (via ELK), SVG renderer.
  CommonJS export at the bottom, and plain globals when inlined in a page. Splitting it into
  modules is on the roadmap; keep both entry styles working when you do.
- `examples/playground/*.trace`: the seven examples shown in the playground.
- `examples/cases/*.trace` and `*.mmd`: ten real-world diagrams, each in Trace and in Mermaid,
  with notes in `cases.json` (what Trace uses, what is still missing). These are the regression
  suite and the showcase.
- `reference/`: the user's hand-drawn SVGs and the page that compares them with the Mermaid they
  replaced. Never edit these.
- `playground/template.html`: the live editor page. `playground/compare-template.html`: the
  Mermaid-vs-Trace page. Both get `src/trace.js` inlined by the build.
- `tools/`: `render.js` (one file to SVG), `snapshots.js` (all examples to `out/`),
  `build-playground.js`, `build-compare.js` (to `dist/`), `measure.js` (text widths in Node).
- `test/examples.test.js`: every example lays out with no errors, no overlapping nodes, and no
  frame covering a node that isn't its own.

## Commands

```
npm install
npm test                 # parse + layout + invariants for every example
npm run snapshots        # out/**/*.svg, plus .png if @resvg/resvg-js installed
npm run build            # dist/playground.html and dist/compare.html
node tools/render.js examples/cases/dmz.trace out.svg
```

## How to work on layout

Layout changes have side effects across diagrams. After any change to `src/trace.js`:
run `npm test`, run `npm run snapshots`, and look at the PNGs of every example, not only the one
you were fixing. Most bugs found so far were only visible in a picture (a frame swallowing a
node, a title under a box, a jog in a link). If you add a feature, add or extend an example that
uses it.

Node measures text with an approximate width table (`tools/measure.js`); the browser measures
with canvas and Inter. Snapshots are therefore close to, not identical with, the browser.

## Style rules (from the reference SVGs)

- Palette and classes are fixed in `PALETTE` and `diagramCSS()`; output must work in light and
  dark (`prefers-color-scheme` in the standalone SVG, page theme in the playground).
- Node label: bold 13px name, muted 11px note under it. Edge labels: muted 11px with a halo.
- Orthogonal links with 7px rounded corners; arrowheads end just short of the box.
- Semantic kinds, not colours: box, store, engine, state, pill, ask, start, final; tags ok, bad,
  dashed, muted; frames green, blue, orange, purple, grey.
- Restraint: no shadows, no gradients, no colour without meaning.

## Naming

The name is Trace, without an accent (it was briefly “Tracé”). The npm name `trace` is taken;
the package is `trace-diagrams`, files use `.trace`.

## Conventions

- Error messages tell the person what to write instead, and carry a line number.
- UI text uses typographic apostrophes and quotes; code and syntax keep straight ones.
- Don't add dependencies to the engine beyond elkjs without a reason; pages load elkjs 0.9.3 as a
  UMD script from jsDelivr, pinned.
