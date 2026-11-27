# Roadmap

What is left to do, by theme, the most wanted first. What is done is described in `docs/language.md`,
`docs/architecture.md` and `docs/drawing-rules.md`, and its history is in git.

## Next (wanted by the owner)

1. **One language, fewer names** (from the review of the language, November 2026; none of it breaks a diagram):
   - `[gather]` on links: the tagged links into one node are gathered from two up. Perhaps named sets
     (`[gather tokens]`) and `[apart]` to keep a link out, only if a real diagram needs them.
   - One name for gathering everywhere the user sees it: `[gather]` on a node, `[join]` kept as an alias.
   - A side zone always says `side` (`[side top]`, never `[top]` alone); the icon above the text becomes `[icon-top]`
     (`top` kept as an alias).
   - Warnings: a name that is both a tag and an icon (suggest `lucide/…` or `logo/…`); a `->` inside a link label
     (`a -> b : one -> c` is one link labelled "one -> c").
   - Block titles may also be written with a colon (`frame dmz: DMZ [orange] {`), like node labels.
   - Dots in names reserved for table columns (`orders.customer_id`), with an error saying what to write.
2. **From Mermaid** (the owner's picks):
   - Link styles: a thick link for the main path (`==>` or `[main]`), a cross end for refused traffic (`-x`).
   - Notes beside a node or a zone (`note fw : …`), a small box with a dashed leader, placed like a leaf node.
   - Text formatting in labels: `**bold**`, `*italic*`, `` `code` ``; the width measure must know the runs.
3. **Layout recommendations**: analyse a diagram and suggest the hint that would improve it (a row across the
   flow, `align`, a side zone, `span`, `bridge`), from the rules in `docs/layout-guide.md`; applied by the author,
   or tried and compared with the engine's own cost. Not designed in detail.

## Layout quality: open problems

- Links between zones in different rows of a grid loop round it when the zones are far apart (DMZ to app).
- A bridge between rows (a firewall on a horizontal border while the diagram flows right).
- The per-zone layout gives up when even the margin route is blocked; a short jogged stub would let more through.
- Links along a zone border: Kafka in the flat layout, the margin stub in zero trust, a `[join]` link in the full
  event-driven orders.
- A link label crossed by a link through a narrow gap (office network, full: backup to NAS).
- Dense publish/subscribe and log fan-ins stay tangled even with rows (event-driven orders, security operations).
- The OpenTelemetry held-out diagram stays busy (one node used by most of the diagram, no zones in the source).
- The hub case is busy: Orders' links cross inside the zone, the login links run round the whole drawing.
- Members of a gathered set in several columns of a zone reach its line round each other (hub: Search, Catalog).
- A dashed bus looks a little heavier on its shared stretches (the strokes add up); draw them once.
- Link labels in a flow going down take a whole row; and ELK sometimes puts a label below a horizontal link.

## Features, smaller

- Rails: taps routed round the nodes in their way (today they cross and warn); labels on the bus; several rails
  on one side, or between two parts of the diagram; the rail's nodes level with their main source.
- `align` across stacks in different zones with a bridge between.
- Links to zones: a link from a zone to something inside it makes the layout fall back; `mark` takes no links from
  zones; `[span]` ignores a node beside a column of zones; side zones refuse links to zones.
- Side zones: a bus along the gutter for many collectors; an `[agent]` dot on nodes.
- Gathering: links with different labels gathered under one line.
- `mark` for only the links with a given label (`mark idp : validate token`).
- Sequence diagrams: activation bars, the participants repeated at the bottom of a long diagram, numbering,
  `create` and `destroy`; a message across several lifelines passes over the ones between.
- Tables: a table inside a row or column of nodes loses the row-level attachment; a table read from SQL.
- Logos: a way to bring your own (Oracle has none).

## Engineering

- Split `src/trace.js` into modules (parse, measure, layout, tidy-up, render), keeping both the CommonJS and the
  inline-in-a-page builds.
- Simplify the layouts: make the per-zone layout as good as the flat one where both are valid, then drop the flat
  layout and `straightenSpans`.
- Speed on large diagrams: the full GitLab component diagram (about 80 links) takes over four minutes in Node.
- Playground: share a diagram by link, syntax highlighting.

## Decided against, or tried and not kept (so they are not redone)

- Placement statements (`place app below dmz`, `proxy beside fw`): where a node stands is written with rows,
  columns and zones (owner, November 2026).
- A snake (rows flowing alternately right and left), as a feature or automatically: write a row right to left, or
  use one column (owner, November 2026).
- Mermaid's thirty node shapes: kinds and icons say what a node is. Mermaid's diagram types that are not boxes and
  links (class, Gantt, pie, quadrant, XY chart, sankey, radar, git graph, timeline, user journey, requirement,
  kanban, packet, block, treemap): out of scope (owner, November 2026). Its sequence and state extras (activation
  bars aside) are not picked for now.
- A fixed pixel width (`width 200`): breaks when a label changes; `same-width` says the relation instead.
- An "opener" mark or link style for a connection opened one way while traffic flows the other: the label says it.
- A "call back" style for links running back into the previous column (k8s): mocked as a loop and as a return
  lane; today's routing kept (owner, November 2026).
- A grid of tables: zones by domain already work, and no arrangement beat the automatic layout.
- Routing links that go against the flow through the gaps between zones: shorter, but many more crossings (head
  office network: 7 instead of 1).
- Centring the head of a drawing over the widest row: ELK already centres it over what it feeds; moving it cost
  crossings and bends (held-out +4 bends, examples +28).
- Link labels made to take no room in the layout (ELK's `edgeLabels.inline`, or labels given to ELK at 1 px): no
  effect, or 7 more crossings and 10 more bends on the held-out set.
