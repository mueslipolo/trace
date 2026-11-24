# Architecture

`compile(src, measure, ELK, opts)` in `src/trace.js` runs four stages. `measure(text, font)`
returns a width in px: canvas in the browser, `tools/measure.js` in Node.

## 1. Parse (`parse`)

Line by line into a model: `nodes` (Map), `frames` (Map), `groups` (columns and rows), `edges`,
`keys`, settings, and a container tree (`root` → frames → groups → nodes, each with `items` in
source order). Errors are collected with line numbers; parsing continues after an error.

## 2. Size and stack (`layout`, first half)

- Nodes are sized from wrapped text (`sizeNode`), edge labels likewise (`sizeLabel`).
- Each column/row is laid out by hand, not by ELK: members stacked with gaps sized to their
  internal link labels, uniform cross size for stacks across the flow, slot sizes shared between
  sibling stacks of equal length, optional title header. The stack becomes one ELK node (`G:id`)
  with FIXED_POS ports where outside links attach (one per link, spread when several share a side).
  Port side rules: a stack across the flow gets in-links on its in-side and out-links on its
  out-side; a stack along the flow uses its end members' in/out sides and the perpendicular sides
  for middle members.
- `[span]` nodes are stretched to the extent of the stack they link to and get FIXED_POS ports at
  each member's centre; links to another stack get ports in proportion.

## 3. ELK

One ELK `layered` run over the whole graph with `hierarchyHandling: INCLUDE_CHILDREN`, frames as
compound nodes (`F:id`), orthogonal routing, model order respected (`considerModelOrder`), network
simplex node placement. Spacing scales with `spacing`.

## 4. Post-processing (in this order)

1. Read back absolute positions. Edge sections come relative to the edge's `container` (offset
   by that container's absolute position); stubs join group ports to the member boxes; ELK
   self-loops are replaced with roomier loops on the side ELK chose.
2. `compactBridges`: squeeze the empty strip ELK leaves between a `[bridge]` node and the frame
   feeding it (two frame paddings plus a gap). Points inside a squeezed strip are scaled, not
   shifted, to keep links orthogonal.
3. `straightenSpans`: if a span node is offset from its stack by the same amount on every link,
   slide its frame over, but only if that hits no node and crosses no other link. Links crossing
   the slid frame's edge get a jog.
4. `fitFrames`: frames shrink-wrap their content; a frame widened for its title grows away from
   neighbours; bridged frames are cut at the bridge's centre and the feeding frame extended to
   meet it; the pair is made into bands (same span across the flow), repeated until stable. Every
   growth step is refused if it would cover a node or frame that belongs elsewhere. Finally the
   canvas is shifted and grown so frames and labels fit.
5. `render`: frames (outer first, title in the first corner free of nodes), links, nodes, link
   labels, legend. Preview SVGs carry no style (the page styles `.dg`); `standalone` SVGs embed the
   light palette plus a `prefers-color-scheme: dark` block.

## ELK lessons (each cost a debugging session)

- A label with empty `text` is never placed (comes back at 0,0). Always pass the real text.
- `elk.json.shapeCoords: ROOT` does nothing in 0.9.3; child coordinates stay relative to the
  parent. `edgeCoords: ROOT` is unreliable for edges ELK moves into a compound node; use the
  edge's `container` field instead (what the code does now).
- With INCLUDE_CHILDREN, ELK keeps compound nodes roughly centred on each other, which can
  leave a node offset from what it links to in another frame. That is why `straightenSpans`
  exists, and why “draw frames after layout” is on the roadmap.
- `elk.nodeSize.minimum` on compound nodes is not reliably respected for spacing; frames widened
  for their title can overlap neighbours unless post-processing handles it (it does).
- Edge labels in `layered` become dummy nodes and take a layer of their own: wide gaps in
  direction right, tall gaps in direction down. TAIL placement avoids the layer but labels then
  overlap freely; reverted.
- Strings with `$` in them break `String.replace` when used as replacements (`$'`, `$&`); build
  scripts pass replacement functions.

## Testing

`npm test` checks every example for parse errors, overlapping nodes and frames covering foreign
nodes. It cannot judge looks: run `npm run snapshots` and look at the PNGs.
