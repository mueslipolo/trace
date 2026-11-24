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
- Dots where taps meet the bus, and labels on the bus instead of on each tap.
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

Left: aligning a node that is not in a row or column (the layout only tries to keep the link
straight); aligning across stacks that are in different frames with a bridge between.

## Equal sizes (done: `same-width`, `same-height`)

Done: `same-width a b c` for nodes (before layout) or frames (after: grown to one common box). Not done:
a fixed pixel width (`width 200`), which would break when a label changes and narrow nodes into tall
ones; a diagram-wide minimum node width.

## 5. Sequence diagrams

A separate layout mode (participants as lifelines, messages as horizontal arrows, notes,
alt/loop blocks), drawn in the same style as the other diagrams.

## 6. ER / table diagrams

Tables with columns, PK/FK markers, dashed links for non-FK references.

## 7. Icon set (done: I.1 to I.3 in one go, I.4 left)

Done: icons are tags in the node's brackets (`fw [firewall]`, `lb [loadbalancer top]`); 33 friendly
names map to Lucide icons and every Lucide icon works under its own name (`lucide/` prefix for a
name that clashes with a tag). Drawn in ink, left of the text or above it with `top`. Left:
a gallery in the playground, showing the icon-load warning in the playground, more aliases as
they are needed. The cases use icons now (all but `payment`, a state machine).

Original plan:

A set of polished built-in visuals for the common diagram elements (database, server, user,
cloud, browser, queue, firewall, storage, then load balancer, container, API, lock, mobile,
internet). Flat single-weight line icons in the existing palette, working in light and dark:
no shadows, no gradients. Planned as slices, each keeping `npm test` green:

- I.1 Syntax and plumbing: `[box] db icon=database : Orders`; unknown names give an error with a
  line number and the valid names; the node grows to fit the icon.
  Test: `node tools/render.js` on a one-node file shows the icon in the SVG.
- I.2 First set of about 8 icons, with `examples/playground/icons.trace` showing all of them.
  Test: `npm run snapshots`, look at the PNG in light and dark.
- I.3 Second set for network and ops.
- I.4 Use icons in the ten cases, document the names in `docs/language.md`, add a gallery to the
  playground. Test: `npm run build`, open `dist/playground.html`.

## 8. Ports and protocols in the cases

Several of the ten cases (`dmz`, `hybrid`, `office`, `zerotrust`, `k8s`, `payment`) should show
more network links, labelled with ports and protocols (`: 5432/tcp`, `: 443 mTLS`). Content work
on the `.trace` files and `cases.json`; no language change. Do it after the frame
layout settles (item 2), since longer labels widen the gaps. Test: `npm test`, then look at every
snapshot.

## 9. Layout recommendations (later; designed, not started)

Look at a diagram and suggest the layout features that would improve it (rows, columns, `align`,
`same-width`, `rail`, `span`, `direction down`), as concrete source edits, each measured before it is
shown. Decided in a brainstorm, not built; the user asked to leave it for later.

Approach (chosen over open-ended search and over an LLM): **detect, try, measure**.
- Detectors look at the source and the layout result for the symptoms in `docs/layout-guide.md`:
  siblings stacked along the flow, a strip wider than 4:1, a block that repeats the flow, ragged zone
  edges, sources bunching into one node, many links to one control-plane node, one clear pair across two
  stacks with a visible jog. Each proposes one edit.
- The engine applies the edit to a copy, lays it out, and keeps it only if it clearly scores better
  (bends, text size at page width, plus the symptom it targets) and creates no new symptom.
- Layout edits only: never the nodes, links or labels. At most three suggestions, each with the reason
  (a line from the guide) and its measured effect (for example 34 to 24 bends).

How a person uses it (their choice, both wanted):
- **Apply one by one**: preview a suggestion, apply it, the others are re-checked against the new
  diagram.
- **Auto-apply and compare**: apply every verified suggestion at once and show before and after side by
  side, with a way to take back any one of them.

Where: a Suggestions panel in the playground (Preview, Apply, undo) and `tools/suggest.js` for the
command line; the core is a function that takes source and returns suggestions, so both use it.

Noise control: only verified suggestions; do not repeat one that was applied or dismissed (a dismissal
is a `# no-suggest rail` comment in the source); stay quiet on a diagram that is already fine.

Benchmark, already available: the ten cases exist as `examples/cases/simple/` (what a user starts
from) and `examples/cases/` (the hand-tuned full form). The suggestions for a simple case should
rediscover the features of its full form; count how many it finds and how many it proposes that the
full form does not have.

Open for when it is built: whether dismissals live in the source or in the playground only; how to
preview (side by side or toggle); how the cost weights are tuned.

## Smaller items

- Split `src/trace.js` into modules (parse, measure, layout, postprocess, render) without breaking
  the inline-in-a-page build.
- Real font metrics in Node (Inter advance widths via a font file), so snapshots match the browser.
- Labels placed above horizontal links consistently (ELK sometimes puts them below).
- Edge labels in direction down take a whole row; find a placement that sits beside the link.
- “Call back” links that run backwards into the previous column (k8s: web pods calling svc/cart)
  should loop around the column edge.
- Fan-in to one point (CI “all green?”): optional join/bracket for a column's outgoing links.
- A link style for “connection opened one way, traffic flows the other” (zero-trust connector).
- CLI: watch mode, PNG output, `--dark`.
- Playground: share a diagram by link, syntax highlighting.
