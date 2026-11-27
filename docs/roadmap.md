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
- Relation statements (`place app below dmz`, `proxy beside fw`): decided against (owner, November 2026):
  where a node stands is a design question, answered by writing rows, columns and zones.
- A snake: decided against as a feature (owner, November 2026). Write the row's nodes right to left to get
  one, or use a single column; the automatic fold stays as it is.
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

## Links to zones

Done: a link to a zone works with rows and columns of zones. In the per-zone layout a zone end is the zone's box:
the link ends on a port in the middle of the zone's side facing it when the zone is at that level, or enters the
box round it like any link and stops at the zone's border when it is deeper; the router takes a link ending on a
zone round the nodes, as it does a link between nodes (multi-region SaaS, full: the regions and the shared zone in
one row, CI/CD deploying to each cluster). A diagram without rows or columns of zones keeps the other layouts.
Left: a link from a zone to something inside it still makes the layout fall back; `mark` does not take links from
zones; `[span]` ignores a node beside a column of zones; side zones still refuse links to zones.

## Found while writing the full versions of the held-out diagrams (not yet fixed)

- A link label can be crossed by a link that passes through a narrow gap (office network, full: the label of a
  short backup -> NAS link, crossed by the core -> hypervisor links; worked round by placing the NAS below).
- A link joined with `[join]` can run along a zone border (event-driven orders, full: shipping -> dead letters
  along the Services zone; worked round by leaving the join out).
- Dense publish/subscribe and log fan-ins (event-driven orders, security operations) stay tangled even with
  rows: the services and topics form a staircase that no ordering of two rows fully untangles.

## Links that go against the flow (looked at, not changed)

Tried on the head office network (full, arrangement D): routing links that go against the flow (staff to the NAS,
the 802.1X check, the cameras to the recorder) through the gaps between zones instead of round the outside. The
routes through the middle are shorter but cross many more links (staff to the NAS: 7 crossings instead of 1, the
802.1X check: 5 instead of 3), so the long clean way round stays. What helps is placement: the NAS on its own
line under the backup server lets the SMB link run under the VLAN row and in from the side.

## Centring the head of a drawing (tried, not kept)

Tried on the head office network: a pass that slides everything above the widest row (ISPs, firewall, DMZ, core)
across to the middle of the drawing, its links rerouted. ELK already places that block over the middle of what it
feeds (the core's heaviest links go to the server room), so centring it costs those links: one more crossing and the
core's links cutting into the server room on the head office, a straight link bent on the Kubernetes platform, +4
bends on the held-out set and +28 on the examples. With rules strict enough to keep the counts (no added crossing or
bend, no straight link bent) the moves left still read worse (a log link looping back on zero trust). Writing the
server room under the core does not centre it either: the floors and Wi-Fi beside it keep the core to one side.

## 7. Layout recommendations (later)

Analyse a diagram and suggest the layout features that would improve it (rows or columns across the flow,
align, side zones, span, bridge), from the rules in `docs/layout-guide.md`. Either applied one by one by the
author, or tried automatically and compared with the same cost the engine uses. Wanted, not designed in detail.

## 8. From Mermaid: link styles, notes, text formatting (wanted)

Compared with what Mermaid writes (November 2026), the owner picked three gaps. Each keeps Trace's rules: a
style says something (no free colours or `classDef`), and none of it changes the layout unless it has to take room.

- **Link styles.** Mermaid has thick links (`==>`), circle and cross ends (`--o`, `--x`) and invisible links
  (`~~~`). Candidates: a thick link for the main path (`==>`, or a `[main]` tag), and a cross end for traffic that
  is refused (`-x`, a firewall that drops). Not a circle end: Trace already draws a circle as “optional” on ER links.
  Invisible links are a layout trick, which rows and columns already cover.
- **Notes.** Today only sequence diagrams have them. A note beside a node or a zone (`note fw : stateful, geo-block
  since March`), drawn as a small box with a dashed leader, placed by the layout like a leaf node so it never
  covers anything. Perhaps on a link too.
- **Text formatting.** `**bold**`, `*italic*` and `` `code` `` inside labels, notes and link labels (Mermaid's
  markdown strings). The width measure has to know the bold and monospace runs, in Node and in the browser.

Out of scope (owner, November 2026): Mermaid's diagram types that are not boxes and links (class, Gantt, pie,
quadrant, XY chart, sankey, radar, git graph, timeline, user journey, requirement, kanban, packet, block,
treemap). Trace is for diagrams of things and the links between them.

Decided against: Mermaid's thirty node shapes (owner, November 2026). Kinds and icons say what a node is.
The gaps in sequence diagrams (activation bars, `autonumber`, `critical`, `break`) and state diagrams
(composite states, fork and join) are not picked for now.

## Smaller items

- Split `src/trace.js` into modules (parse, measure, layout, postprocess, render) without breaking
  the inline-in-a-page build.
- Done: real Inter metrics in Node (`tools/measure.js`, devDependencies `@expo-google-fonts/inter` and
  `opentype.js`; no kerning, about a percent), PNGs drawn with the same font (`tools/png.js`), and the CLI
  takes `out.png`, `--dark`, `--light`, `--zoom` and `--watch`.
- Labels placed above horizontal links consistently (ELK sometimes puts them below).
- Edge labels in direction down take a whole row; find a placement that sits beside the link. Tried: ELK's
  `edgeLabels.inline` (no effect in 0.9.3), and labels given to ELK at 1px so they take no room (the incident
  case got 6% shorter, but the held-out set got 7 more crossings and 10 more bends: rejected).
- “Call back” links that run backwards into the previous column (k8s: web pods calling svc/cart): mocked as a
  loop over the column and as a return lane; the owner kept today's routing (November 2026).
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
- Done: `[join]` on a node asks for the bus from two links up (CI “all green?”, the DMZ's SIEM); chosen among a
  bar, a bracket, a bus with a dot and fork-and-join. A bus is no longer refused for a zone border that is level
  with it but in another row. Rejected: placement statements (`place proxy beside fw`: a design question, written
  with rows), an opener mark for “dials out, then traffic flows in” (the label says it), a grid of tables (zones
  by domain are already possible and none of the arrangements beat the automatic layout).
- Done: links that go to or leave one node with the same label and style, five or more (`gather N`), are merged into a bus
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
