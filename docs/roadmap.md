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

## 7. Layout recommendations (later)

Analyse a diagram and suggest the layout features that would improve it (rows or columns across the flow,
align, side zones, span, bridge), from the rules in `docs/layout-guide.md`. Either applied one by one by the
author, or tried automatically and compared with the same cost the engine uses. Wanted, not designed in detail.

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
- Done: a strip wider than 3.5:1 is retried as two or three rows (`foldCandidate`; `TRACE_NOFOLD=1` or
  `compile(..., { off: ['fold'] })` switches it off). Kept only when the finished drawing has less width, no more
  crossings, at most 15% more bends, no more labels crossed and no return link longer than 30% of the width.
  Analysis: every fold of a chain adds one link that returns to the start of the next row (k8s: 907 px, the
  hybrid case: 1038 px), so most strips with frames stay strips. The real fix is a snake: alternate rows flowing
  right to left, so the end of one row sits above the start of the next (ELK has `direction LEFT`; the fixed
  ports and the frames' insides need to be mirrored with it). Not built.
- Done: title (always drawn), `caption`, `cartouche { key: value }`.
- Done: side zones (`[side]`, `[side left|right|top|bottom]`, `[span]` on a frame): placed beside the main flow, level
  with the zones they are linked to, optionally spanning them; several per side, both sides, nested frames, root nodes
  in the main flow. Left: links to a zone (not a node) are refused while side zones exist; the bus along the gutter
  for many collectors; an `[agent]` dot on nodes.
- Fan-in to one point (CI “all green?”): optional join/bracket for a column's outgoing links.
- Done: links that go to or leave one node with the same label and style, four or more, are merged into a bus
  (`mergeHubs`); a bus never crosses another bus's line. Five or more between one node and members of one zone it
  is not in meet at a bar inside that zone (`addJunctions`, `placeOnConcentrators`; cases `hub` and `home`). Left:
  an escape hatch to switch merging off or force it on fewer links; merging links with different labels; members
  in several columns of a zone reach the bar round each other (hub: Search in front of Catalog).
- Done: `mark node "text"`: the links into a node drawn as its icon on each sender, with a legend line (case
  `monorepo`). Left: marking only the links with a given label (`mark idp : validate token`).
- Done: technology logos as icon names (`[database postgresql]`, `[go]`, `[kubernetes]` on a zone), from Simple
  Icons, one colour, forty-five bundled. Left: a way to bring your own logo (Oracle has none); logos in the
  showcase cases.
- Done: the router (`rerouteBlocked`) for links through or along nodes, detours and overlaps; hops where links
  cross; every link orthogonal (tested). Left: the OpenTelemetry held-out diagram stays busy (a node used by most
  of the diagram, and no zones in the source).
- Done: metrics over the examples and a held-out set of real C4 and Mermaid diagrams (`npm run metrics`,
  `examples/holdout/`), a Mermaid converter (`tools/mermaid-to-trace.js`) and a page drawing each held-out
  diagram with Trace and Mermaid (`dist/compare.html`). Left: layout speed on large diagrams (the full GitLab
  component diagram, about 80 links, takes over four minutes in Node, so it is not in the held-out set).
- Done: zones in a row share their top; a link into a zone member boxed in by its neighbours no longer makes the
  per-frame layout give up.
- A link style for “connection opened one way, traffic flows the other” (zero-trust connector).
- Playground: share a diagram by link, syntax highlighting.
