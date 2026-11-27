# Architecture

`compile(src, measure, ELK, opts)` in `src/trace.js` runs four stages. `measure(text, font)`
returns a width in px: canvas in the browser, `tools/measure.js` in Node.

## 1. Parse (`parse`)

Line by line into a model: `nodes` (Map), `frames` (Map), `groups` (columns and rows), `edges`,
`keys`, `marks`, settings, and a container tree (`root` → frames → groups → nodes, each with `items` in
source order). Errors are collected with line numbers; parsing continues after an error.

After the last line:
- table columns named in links are resolved, `same-width`/`same-height` and `align` are checked;
- each `mark` takes the links that arrive at its node out of `model.edges` (they never reach the layout) and
  records the mark on the nodes they came from;
- `desugarSides` wraps the main flow and the `[side]` frames into lanes (ids `_side…`) beside each other.

Icons and logos are tags: an unknown word in a node's brackets is a Lucide icon (`iconKnown`) or, if not, a
Simple Icons logo (`isLogoTag`; `logo/` forces it). A frame's brackets take a logo too. `compile` fetches the
drawings a model needs and does not have (`loadIcons`) before it lays anything out.

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
- A node with a logo and a role icon has the technology's name in front of its note (sized here); a node
  marked by `mark` is widened for the mark's icon after its name.

Before any of this, `addJunctions` (unless merging is off) finds five or more links (`gather N`) with the same label and
style between one node and members of a zone that node is not in, and routes them through a concentrator: a
node of kind `junction` inside that zone (the members' links go to it, one trunk carries the label to the
node outside). It is sized as a bar across the flow and gets FIXED_SIDE ports, one side for the members, the
other for the trunk, so ELK orders the members along it. In the per-frame mode it is constrained to the first
layer of its zone for a fan-out, the last for a fan-in.

## Sequence diagrams (a separate path)

`parse` records an ordered `events` list (messages, notes, group starts and ends, dividers) next to the
nodes and links, and `mode: 'sequence'` when the line `sequence` is present. `compile` then calls
`layoutSequence` instead of `layout`: no ELK. It spaces the lifelines (neighbouring boxes must not
touch; every message label, self message and two-participant note must fit in the span it crosses,
shortest spans first), walks the events down the page, and returns the same shape the renderer already
draws: boxes for participants and notes, frames for groups (with the title at the left), and links for
lifelines, messages and dividers. The flow-layout invariants in the tests are skipped for these.

## Tables

A `table` is a node of kind `table` with `cols`. `sizeTable` sizes it from its header and its widest
row (marker column included); `tableSVG` draws it. A link to `table.column` is read as a link to a node
of that name and turned back into the table plus the column once the whole source is read (a table may
come after the link). Each linked column gets a fixed ELK port at its row, on the in or out side, like a
span node; ports on the same row are spread within it. In the per-frame mode the port on the enclosing
frame is placed at that row too, and only that side is tried.

## 3. ELK

One ELK `layered` run over the whole graph, orthogonal routing, model order respected (`considerModelOrder`), network
simplex node placement. Spacing scales with `spacing`.

`layout` tries three ways to place frames and keeps the valid one with the fewest link bends
(ties go to the earlier one). A candidate is valid when no frame covers a node that is not its own
and no two unrelated frames overlap more than 2px, every link starts and ends on its nodes, and every
concentrator stands beyond what it gathers (after its members for a fan-in, before them for a fan-out).

1. **Per frame** (`hierLayout`): bottom-up, each frame is laid out by its own ELK run; a finished
   frame is an opaque node with fixed ports in its parent's run. A link to a member inside a frame
   gets a port on the frame's border (in-side, else top/bottom) and a straight stub to the member,
   so the member must be reachable in a straight line. If every straight line is blocked (a link
   into the middle of a stack), the stub runs along the frame's inner margin and turns into the
   member's side. If that is blocked too, the link still enters from the facing side and the router
   takes it round the members afterwards (`rerouteBlocked`). A `[bridge]` stays inside its frame's
   run, and `fitFrames` later moves the frame border to its centre. Not supported: links that
   name a frame.
2. **Flat**: frames are not ELK nodes; only members are laid out and `fitFrames` draws the frames
   afterwards.
3. **Compound**: frames are ELK compound nodes (`F:id`, `hierarchyHandling: INCLUDE_CHILDREN`).
   Always valid; the fallback.

A row or column that holds frames is a *lane* (`type: 'lane'`, made in the parser when a block opens
inside a group). Lanes only exist in the per-frame mode, where a lane is a borderless container with
its own ELK run: direction along the lane, children in source order (`elk.partitioning`), no
straightening (`SIMPLE` placement) and no packing of unlinked children. The shared prep code asks
`fhOf(item)` for the flow direction at that item, and `portFor` takes the direction of the graph that
holds the frame it makes a port on. A row of zones (not the rows side zones are built from) shares its top:
`alignRowTops` moves every zone to the row's top after its ELK run and redraws the links between them, over
the row when another zone stands between. If the per-frame mode returns nothing, `layout` draws the
diagram without the lanes (flat and compound treat a lane as transparent) and adds a note, which
`compile` returns as a warning. Bridge fitting only pairs frames that are level on the other axis.

A fourth candidate, `hierwrap`, is the per-frame layout with ELK's `MULTI_EDGE` wrapping on the root
graph (a long chain of layers folds into rows). It is only tried when the first result is more than 4
times wider than tall, also for diagrams without frames. Candidates are compared by cost: link bends
plus 160 times how much the text shrinks when the drawing is fitted to a 1100px page. A later candidate
must beat the best so far by 3% (8% for folding, whose long return links are a real cost), so a near
tie keeps the simpler layout. A candidate is also rejected if any link does not start at its source and
end at its target: ELK's wrapping cuts some labelled links short.

When some link points against the declaration order (`a -> b` with `b` declared before `a`), that makes
a cycle, and ELK's default breaks it wherever it likes. Every layout is then also tried with
`cycleBreaking: MODEL_ORDER`, which reverses exactly those links; that is what `<-` asks for by hand.
It has to win by the same 3% margin. A diagram without such a link is laid out once, as before.

A layout block (lane) places its children with ELK's `SIMPLE` strategy so a grid stays tidy, but that
leaves the placeholders for link labels where they fall and zig-zags the links between children. For a
diagram with blocks both `SIMPLE` and `NETWORK_SIMPLEX` are tried and the better (by the same cost) is
kept, `SIMPLE` unless the other wins by 3%. Links into a `[span]` node that sits inside a frame are
given a port on the frame at the span node's own attachment point, so they stay straight.

`same-width` and `same-height` are applied in two places: on nodes before stacking (`equalNodes`, again
after the span nodes have grown, for nodes outside a stack), and on frames after `fitFrames`
(`sameSizeFrames`), which looks for one box holding every listed frame so they also share an edge.

Rails (`type: 'rail'`, only at the top level) take no part in any layout: their nodes and the links to
them are skipped by every ELK graph, and `placeRails` runs after `fitFrames`. It finds the bounding box of
everything placed, puts the band beside it (shifting everything for a top or left rail), lays the nodes
in the rail along the bus, and adds the links as ordinary entries in `rm.edges`: a bus, one straight tap
per link, and an arrow from the bus into each node in the rail. Taps that would cross a node produce
warnings through `rm.notes`.

Before that, `clearFrames` keeps links off frame borders: a stretch in the middle of a link that runs
along a border closer than 8px (ELK routed it before the frames were drawn tight, or a node on a border
sent it along that border) is moved to 12px from it, when that touches no node and runs along no other
link. The first and last stretch of a link stay on their nodes. `alignJogs` knows about borders too, so
it does not put a step back where a border is. A node on a border sends its rail tap off the middle.

Labels are placed last (`placeLabels`, after `alignJogs`). ELK keeps a label off the nodes but not off the
other links, and it can leave one far from its own link. A label that a link, a node or another label runs
through, or that sits more than 16px from its own link, moves to the nearest clear place along its own
link: above or below a horizontal stretch, left or right of a vertical one, at several points along it,
and also wrapped onto two lines when the one-line label has no room. A label that is clear is never
touched. Frame titles and row and column titles are chosen at drawing time and avoid links, nodes and
labels too; they scan along an edge for the free place nearest the corner or the middle.

`align` has two parts. For nodes in two stacks the stacks are padded (before layout) and one is slid the last
bit afterwards. For single nodes and nodes in zones (`alignLoose`) the node, or the outermost zone round it
that does not hold the other node, slides with its contents; both go through one `slide` helper that refuses a
move that would touch a node or cross a link, and the link between the two nodes is redrawn straight.
`simplifySnakes` collapses a link that goes across, down, across, down, across into one run across the gap
(down, across, down) when that run is clear of nodes and other links, at the place farthest from frame borders.

A last pass, `alignJogs`, runs on the chosen layout (after the choice, which is made on point counts it would change) and tidies links that have a single step: those that share a target (or source)
get their steps at one height, in the middle of the gap, when that touches no node and runs along no
other link. It changes no bend count.

`TRACE_LAYOUT=hier|flat|compound` forces one mode; `TRACE_NOWRAP=1` turns folding off;
`TRACE_NOCYCLE=1` skips the declaration-order variant. Today per-frame or flat wins for every example that has frames except the ones where compound has
fewer bends.

## 4. Post-processing (in this order)

Steps 1 to 4 belong to each candidate layout; `finish` (below the list) runs on the one chosen.

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
5. `sameSizeFrames` (frames named by `same-width`/`same-height`, never grown into another frame, 10px
   clear), then `placeRails`.

`finish`, on the chosen layout, in this order (each is a general rule recorded in `docs/drawing-rules.md`):
- `placeOnConcentrators` (the concentrator is drawn as a thin bus line with dots): the line reaches along its members; each link meets it at its member's level
  (straight when nothing is in the way, else the layout's route to a free place 10px from the others); the
  trunk meets it between two members' links.
- `spanSides` (side zones that span), `clearFrames` (links off frame borders), `alignJogs`, `simplifySnakes`.
- `mergeHubs`: five or more links (`gather N`) with one label and style to or from one node become a bus (not for
  concentrators); a bus never crosses another bus's line.
- `rerouteBlocked`: a Dijkstra router on a grid round the nodes, for links that run through or brush a node,
  hug it, run along a frame border, or make a detour; it pays for bends, crossings and running beside another
  link, and a new route may not add crossings (one for a detour that halves the route).
- `straightenSmallJogs`, `reorderEnds` (the order of ends on a side that crosses least), `spreadEnds` and
  `separateParallels` (ends and parallel stretches kept apart), `resolveOverlaps` (any two links still on top
  of each other: one is routed again), `placeLabels`.

Then, for a strip wider than 3.5:1 and 1500px, `foldCandidate` tries rows of its top-level items and keeps
them only when clearly better.

6. `render`: frames (outer first, title in the first corner free of nodes, a logo before it), links (a hop
   where a horizontal link crosses a vertical one), nodes (role icon, logo, marks after the name,
   concentrator bars), link labels, legend (keys and marks). Preview SVGs carry no style (the page styles
   `.dg`); `standalone` SVGs embed the light palette plus a `prefers-color-scheme: dark` block.

## ELK lessons (each cost a debugging session)

- A label with empty `text` is never placed (comes back at 0,0). Always pass the real text.
- `elk.json.shapeCoords: ROOT` does nothing in 0.9.3; child coordinates stay relative to the
  parent. `edgeCoords: ROOT` is unreliable for edges ELK moves into a compound node; use the
  edge's `container` field instead (what the code does now).
- With INCLUDE_CHILDREN, ELK keeps compound nodes roughly centred on each other, which can
  leave a node offset from what it links to in another frame. That is why `straightenSpans`
  exists, and why frames are also laid out one zone at a time (the per-zone layout).
- `elk.nodeSize.minimum` on compound nodes is not reliably respected for spacing; frames widened
  for their title can overlap neighbours unless post-processing handles it (it does).
- Edge labels in `layered` become dummy nodes and take a layer of their own: wide gaps in
  direction right, tall gaps in direction down. TAIL placement avoids the layer but labels then
  overlap freely; reverted.
- Strings with `$` in them break `String.replace` when used as replacements (`$'`, `$&`); build
  scripts pass replacement functions.

## Testing

`npm test` checks every example for parse errors, overlapping nodes, frames covering foreign nodes, links
through nodes, links on top of each other and slanted stretches, plus targeted tests per feature. It cannot
judge looks: run `npm run snapshots` and look at the PNGs.

`npm run metrics` (`tools/metrics.js`) counts what makes a drawing worse (links through or brushing nodes,
overlaps, crossings, bends, links along borders, crossed labels...) over the examples and over
`examples/holdout/`, real C4 and Mermaid diagrams never tuned on, and compares with `metrics/baseline.json`.
A layout change is kept only if the held-out set does not get worse (`--check` makes that an exit code, `--json`
writes the counts for a pipeline). `dist/compare.html` shows each held-out diagram drawn by Trace as first written,
by Trace with its full features, and by Mermaid; the Trace drawings are rendered at build time, so the page can be
built and archived by a pipeline, and only the Mermaid column needs a browser and the network.
