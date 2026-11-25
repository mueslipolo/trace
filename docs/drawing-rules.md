# Drawing rules

What makes a Trace diagram look right, learned case by case from the owner's reviews of the showcase. Each
rule says where it came from, how Trace keeps it today, and how a diagram could be checked for it: the last
column is the raw material for automatic layout suggestions (roadmap item 7).

How a rule is kept:

- **engine**: a general routing or placement rule, applied to every diagram with nothing to write.
- **feature**: the author writes something (a tag, a block, a statement) and the engine does the rest.
- **usage**: no new code, a case was improved by using existing features better.

When a review leads to a change, add the rule here in the same commit, and run `npm run metrics`: a rule is
kept only if the held-out diagrams (`examples/holdout/`) do not get worse.

| Rerouting never adds crossings (unless a link ran through a node; two at most to separate links on top of each other); the router pays 40 px per crossing. | metrics: today's rerouting had raised crossings from 52 to 72 over the examples | engine: `rerouteBlocked` | crossings before and after a change |

## Links

| Rule | From | Kept by | How to check it |
|---|---|---|---|
| A link keeps 6 px clear of every node that is not one of its ends; routed round if it cannot pass between them. | office (web proxy to firewall brushing VLAN 40) | engine: `rerouteBlocked` treats it like a blocked link | a stretch within 6 px of a node |
| A link never runs through a node that is not one of its ends. | zero-trust (VPN link behind the connector), office (firewall link behind the core switch), shop model | engine: `rerouteBlocked` routes it again on a grid around every node; test "no link runs through a node" over every example | any segment crossing a node box that is not an end |
| A link does not turn right against a node: its first and last stretch are at least 10 px long. | office (NAC to VLAN 10 hugged the box) | engine: `rerouteBlocked` treats it like a blocked link | first or last stretch under 10 px |
| When two nodes overlap across the gap between them, the link is one straight line. | office (NAC to VLAN 10) | engine: first choice in `rerouteBlocked` | a link with bends between nodes whose ranges overlap |
| A small step (12 px or less) is not worth a bend: slide the end to make it straight. | zero-trust (connector to Git server, 7 px), data platform, Kafka | engine: `straightenSmallJogs` (a span node or table keeps its attachment point) | a 4-point link whose step is under 12 px |
| A link enters its target from the side facing it, never from the far side through the node. | zero-trust (`alignJogs` made the VPN link cross the Git server) | engine: `alignJogs` only reshapes links whose ends face each other | end point on the far side of the target |
| Links leaving one side of a node take the order that crosses least; a fan that crosses itself is the worst case. | Kafka (orders.created: the link to Inventory crossed the one to Payment) | engine: `reorderEnds`, every order tried for up to five links, a straight link gets a step if it has to move | links from one side that cross each other |
| A link does not go out one way and come back: a route clearly shorter (by a fifth, counting 60 px per bend) replaces it, leaving from another side of its source if need be. | ML pipeline (split to training: right, down, left, down), AWS | engine: `rerouteBlocked` tries every link with three or more bends | a link much longer than the shortest clear route |
| Arrowheads on one side of a node are at least 22 px apart (down to 7 px when the side is short and busy). | office (two arrows into VLAN 30), AWS | engine: `spreadEnds` | two link ends on one side closer than the gap |
| A link that arrives on a side where another already ends takes a quarter of the side, away from it, and a free side is preferred. | zero-trust (VPN and connector both into Git server) | engine: port choice in `rerouteBlocked` | two ends on one side of a node |
| Two links never lie on top of each other or run closer than 8 px; a bus and links into one table row are the exceptions, by design. | AWS (app to NAT and app to S3 on one line), shop model (order items to orders and to products), hub (gateway to identity provider over Catalog) | engine: the router avoids other links' lines, a bus branch may not lie on another link, a last pass routes one of any two that still touch; test over every example | two stretches of different links closer than 8 px |
| Where two links cross, the horizontal one hops over the vertical one. | owner's request | render: a 5 px half circle at each crossing (not on sequence lifelines, rails or within one bus) | n/a |
| Two links never run side by side closer than 8 px, nor on top of each other. | AWS (app tier links), shop model, zero-trust (laptop to VPN on top of contractor to proxy) | engine: `separateParallels` pulls them to 12 px; a first or last stretch slides along its node's side, after the arrowheads are spread | parallel stretches closer than 8 px |
| A link does not run along a frame border; it keeps 12 px off it, and a turn is not placed on a border. A link that leaves its node along a border is routed again, its start sliding along the side. | DMZ (SIEM links on the zone borders), office | engine: `clearFrames`, the router avoids lines within 9 px of a border, side-zone links leave bridge nodes below the border | a stretch within 8 px of a frame border |
| A link with one unnecessary extra step (down, across, down, across, down) takes the shorter route. | CI/CD (the "yes, push" snake) | engine: `simplifySnakes` | a 6-point link that fits in 4 |
| Links into the same node step at the same height. | DMZ | engine: `alignJogs` | single-step links into one node with different step heights |
| When a fan-out has no room to become a bus, more space between the layers gives it room. | hub (the gateway's five links) | usage: `spacing 1.3` | four or more links from one node that do not merge |
| Four or more links with the same meaning into one node are one bus with the label once, if there is room for the arrowheads. | hub, column and row (arrows squeezed against the bus) | engine: `mergeHubs`, needs a 46 px gap | four or more links, same target, same label |

## Placement

| Rule | From | Kept by | How to check it |
|---|---|---|---|
| Siblings sit across the flow, not along it. | DMZ | usage: rows in a flow down, columns in a flow right (`docs/layout-guide.md`) | a link that leaves sideways and comes back |
| A pair linked across two stacks is level, so the link is straight. | CI/CD, k8s (cart pods and Redis) | feature: `align a b` | a link between stacks with a step |
| Two stacks with different heights get the same pitch, so all their pairs line up. | k8s (catalog pods and Postgres, 5 px off) | feature: `same-height` on the nodes of both stacks | a constant offset between rows of two stacks |
| Zones side by side share their top and bottom. | hybrid (datacenter and AWS) | feature: `same-height dc aws`; a node outside both that sits in the band they would share (Internet users) has to move out of it, here into a column above AWS | side-by-side zones with different heights |
| A zone beside a taller one lays its content out across the other way, so the two are in proportion. | hybrid (datacenter top to bottom beside AWS) | usage: a `column` holding a `row` inside the zone (a block that flows down) | side-by-side zones with very different proportions |
| Siblings inside a downward stack of zones go in a row. | hybrid (app nodes, databases inside the VPC column) | usage: `row` instead of `column` | links that leave sideways inside a column of zones |
| Tiers have straight sides. | DMZ, hybrid | feature: `same-width` / `same-height` on frames | frames in one stack with different widths |
| Sources feeding one node do not bunch up at its edge. | DMZ (users and partners into DDoS) | feature: `[span]` | links converging on a node narrower than its sources |
| A firewall belongs on the border it guards. | DMZ | feature: `[bridge]` | a node linked into two adjacent zones |
| What watches or administers the diagram stands beside it, not after it. | DMZ (SIEM), data platform (orchestration), the platform study | feature: `[side]`, `[side span]` | a zone that only receives links from several tiers and is placed last |
| A node in a side zone linked to several tiers sits level with the middle link (where it really leaves, off any border), so that one is straight and the others spread evenly round it. | DMZ (internal firewall to SIEM 3 px off) | engine: `spanSides` | a link into a side zone with a step under 6 px |
| A side zone is as tall as the zones it serves, so its links cross the gutter straight. | side-zone mockups | feature: `[side span]` | links into a side zone with steps |
| A diagram is roughly page-shaped; a long chain folds into rows, but not at the price of a link crossing the page. | CI/CD, k8s | engine: chain wrap, `foldCandidate` with its guards | width over 3.5 times the height |
| A long pipeline reads as one row per stage, each row a level line. | ML pipeline (nodes scattered by the automatic wrap) | usage: a `column` of `row`s, one per stage | nodes of one chain at many different heights |
| Topics, consumers and similar stacks are ordered to minimise crossings. | Kafka | usage: declaration order (found by trying every order) | crossings between two stacks |

## Reading

| Rule | From | Kept by | How to check it |
|---|---|---|---|
| Two directions between the same groups are told apart by style. | Kafka (publishes dashed) | usage: `[dashed]` on one direction | links both ways between two stacks |
| Cross-cutting concerns are not drawn as a line per node. | the platform study | feature: side zones, a collector per zone, the bus | a node with links from most of the diagram |
| Every diagram that leaves your hands has a title; a caption and a cartouche when it is shared. | owner's request | feature: `title`, `caption`, `cartouche` | no title |
| Drawings on a page are the same size, scaled down, never up. | features page | page design | n/a |
