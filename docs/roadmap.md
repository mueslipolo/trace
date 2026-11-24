# Roadmap

Ordered by how often each gap came up in the ten real-world cases (`examples/cases/`, notes in
`cases.json`).

## 1. Frame placement hints (done as layout blocks)

Done: a `row` or `column` that holds frames places them side by side or one above the other, in
order; nest them for a grid (`docs/language.md`). The DMZ case is now a 2 by 2 grid instead of one
strip. Chosen over relation statements (`frame pub above priv`) because it needs no extra
vocabulary and maps onto one layout run per block.

Principle (from the user): easy things easy, hard things possible. Full auto layout is the
default; blocks are the escape hatch. Long chains and strips now fold by themselves (see item 2
and `docs/architecture.md`). Not folded today because the long return links cost more than they
save: cicd, hybrid, k8s, the unhinted DMZ.

Left:
- Relation statements (`place app below dmz`, `proxy beside fw`) as sugar for the same thing, if
  nesting blocks turns out to be awkward. Needed by: hybrid cloud (subnet tiers as bands in the
  VPC), branch office (proxy beside the firewall), network boundaries (store network right of the
  workers). Try these as layout blocks first.
- A snake: a row that flows right to left, so a link from the end of one row reaches the start of
  the next without looping round.
- Links between lanes loop round the grid when the zones are far apart (the DMZ to app links); a
  cheaper route or port choice would help.
- Bridges between rows (a firewall on a horizontal border while the diagram flows right).

## 2. Draw frames after layout (done; see what is left below)

Frames are placed three ways and the best valid result wins (see `docs/architecture.md`): per
frame (each frame laid out by its own ELK run, composed with fixed ports), flat, and compound.
Bridges and links into the middle of a stack are handled in the per-frame mode.

Stage C result (measured by link bends on all 17 examples): nothing can be removed yet.
- Flat is valid and best for components, cicd, dmz, kafka and office (per-frame has 2 to 21 more
  bends there). Per-frame is the only valid good result for data, k8s, hybrid, zerotrust and
  network-boundaries. Compound never wins but is the guaranteed fallback.
- `straightenSpans` still matters: without it office goes from 31 to 39 bends.

Left, if someone wants to simplify:
- Make per-frame as good as flat where flat is valid (probably needs span straightening and fewer
  constraints between frames), then drop the flat mode and `straightenSpans`.
- Links that name a frame are not supported per frame (compound handles them).
- Links that run along a frame border (kafka in flat mode; the margin stub in zerotrust sits
  close to the border).
- Per-frame still gives up when even the margin route is blocked; a short jogged stub would let
  more diagrams through.

## 3. Side rails for control-plane links (done: `rail`)

Done: `rail logs "management VLAN" [right] { siem }` plus `fw1 -> logs`. The band, the bus and the taps
are drawn after the layout (`placeRails`), so rails never move the rest of the diagram. The DMZ case
uses it for its SIEM.

Left:
- A tap crosses whatever lies between its node and the rail (it warns). Routing it round the nodes, or
  entering from the far side, would let a rail serve nodes in the middle of the diagram.
- Labels on the bus instead of on each tap. (Dots where taps meet the bus: done.)
- Several rails on one side, and a rail between two parts of the diagram.
- The rail's nodes sit at the far end of the bus; placing them level with their main source would be tidier.

## 4. Row alignment across columns (done: `align a b`)

Done: `align tPay payment` pads one stack so the two nodes sit at the same offset, tells ELK to
straighten the link, and then slides a stack the last few pixels and draws the link as one straight
line (`alignRows`). One pair per two stacks; a pair that cannot be slid without touching a node or
link is left alone, with a warning.

Measured on the Kafka case: it does not remove crossings (4 with or without), and it adds bends to the
other links between the stacks, so the case does not use it. The earlier claim here, that it removes
most crossings, was wrong. It is for a clear one-to-one pair.

Done since: aligning single nodes, and nodes inside zones (the zone slides as a whole).

Left: aligning across stacks that are in different frames with a bridge between.

## Equal sizes (done: `same-width`, `same-height`)

Done: `same-width a b c` for nodes (before layout) or frames (after: grown to one common box). Not done:
a fixed pixel width (`width 200`), which would break when a label changes and narrow nodes into tall
ones; a diagram-wide minimum node width.

## 5. Sequence diagrams (done)

Done: `sequence`, messages (`->`, `-->`, self), notes (`over`, `left of`, `right of`) and `loop`, `alt`
(with `else`), `opt`, `par` groups; `layoutSequence` is its own layout, drawn by the same renderer
(`docs/language.md`). Examples: `job-sequence`, `idempotency`.

Left: activation bars on the lifelines, a participant row repeated at the bottom of a long diagram,
messages that cross several lifelines without touching the ones between (they do pass over them),
numbering, and `create`/`destroy` of participants.

## 6. ER / table diagrams (done)

Done: `table` blocks with typed columns and `pk`, `fk`, `unique`, `null` markers; links to a column attach
at its row (also from outside a frame); several links to one row are spread within it; dashed links for
references without a foreign key. Example: `data-model`.

Done since: cardinality marks (`[n-1]`, `[0n-01]` ...: crow's foot, bars, circle).

Left: tables inside a row or
column of nodes keep table-level attachment only; a table generated from SQL or a schema file.

## Smaller items

- Split `src/trace.js` into modules (parse, measure, layout, postprocess, render) without breaking
  the inline-in-a-page build.
- Done: real Inter metrics in Node (`tools/measure.js`, devDependencies `@expo-google-fonts/inter` and
  `opentype.js`; no kerning, about a percent), PNGs drawn with the same font (`tools/png.js`), and the CLI
  takes `out.png`, `--dark`, `--light`, `--zoom` and `--watch`.
- Labels placed above horizontal links consistently (ELK sometimes puts them below).
- Edge labels in direction down take a whole row; find a placement that sits beside the link.
- “Call back” links that run backwards into the previous column (k8s: web pods calling svc/cart)
  should loop around the column edge.
- Fan-in to one point (CI “all green?”): optional join/bracket for a column's outgoing links.
- Merging links that go to (or come from) one hub: study case `hub` in the showcase (ten links, one label ten
  times). Idea to test: same target and same label merge into one trunk that splits near the sources, label
  written once; automatic by default, with an escape hatch.
- A link style for “connection opened one way, traffic flows the other” (zero-trust connector).
- Playground: share a diagram by link, syntax highlighting.
