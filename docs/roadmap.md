# Roadmap

Ordered by how often each gap came up in the ten real-world cases (`examples/cases/`, notes in
`cases.json`).

## 1. Frame placement hints

Say where a frame or node goes relative to another: `frame pub above priv`, `frame storenet
beside workersnet`, `proxy beside fw`. Needed by: hybrid cloud (subnet tiers as horizontal bands
in the VPC, as in AWS reference diagrams), branch office (proxy beside the firewall), network
boundaries (store network right of workers, with the store network drawn to the right of the workers.
Likely needs item 2 first, or ELK layer/position constraints on compound nodes.

## 2. Draw frames after layout (stages A and B done)

Frames are placed three ways and the best valid result wins (see `docs/architecture.md`): per
frame (each frame laid out by its own ELK run, composed with fixed ports), flat, and compound.
Bridges and links into the middle of a stack are handled in the per-frame mode.

Left:
- Stage C: decide whether to remove `straightenSpans`, the flat mode and the compound fallback once
  per-frame covers everything; keep compound while any example needs it.
- Links that name a frame are not supported per frame (compound handles them).
- Links that run along a frame border (kafka in flat mode; the margin stub in zerotrust sits
  close to the border).
- Per-frame still gives up when even the margin route is blocked; a short jogged stub would let
  more diagrams through.

## 3. Side rails for control-plane links

Logging, scheduling and monitoring links that touch many nodes should run on a lane along the edge
of the diagram, like a bus. Needed by: the SIEM in the DMZ case (left out for now), Airflow and
quality checks in the analytics case. Possible syntax: `rail bottom "logs" { siem }` with links
into a rail routed along it.

## 4. Row alignment across columns

`align tPay payment` to keep a topic level with its main consumer; removes most crossings in the
Kafka case.

## 5. Sequence diagrams

A separate layout mode (participants as lifelines, messages as horizontal arrows, notes,
alt/loop blocks), drawn in the same style as the other diagrams.

## 6. ER / table diagrams

Tables with columns, PK/FK markers, dashed links for non-FK references.

## 7. Icon set

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
