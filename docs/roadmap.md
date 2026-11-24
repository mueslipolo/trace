# Roadmap

Ordered by how often each gap came up in the ten real-world cases (`examples/cases/`, notes in
`cases.json`) and in redrawing the original docs diagrams (`reference/`).

## 1. Frame placement hints

Say where a frame or node goes relative to another: `frame pub above priv`, `frame storenet
beside workersnet`, `proxy beside fw`. Needed by: hybrid cloud (subnet tiers as horizontal bands
in the VPC, as in AWS reference diagrams), branch office (proxy beside the firewall), network
boundaries (store network right of workers, as in `reference/hand-drawn-svgs/security-network.svg`).
Likely needs item 2 first, or ELK layer/position constraints on compound nodes.

## 2. Draw frames after layout

Today frames are ELK compound nodes, and ELK keeps them centred on each other, pulling `[span]`
nodes out of line with the stack they feed (visible as jogs in the branch office and analytics
cases; without the frame they line up exactly). Option: lay out flat with frame membership as
constraints (model order, partitions, or a post pass that keeps members contiguous), then draw
frames around their content with `fitFrames`. Must keep the invariant that a frame never covers a
foreign node.

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
alt/loop blocks). The original docs had two (`job-sequence.svg`, `idempotency.svg` in
`reference/`), both hand-drawn in the target style.

## 6. ER / table diagrams

`reference/hand-drawn-svgs/data-model.svg` is the target: tables with columns, PK/FK markers,
dashed links for non-FK references.

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
