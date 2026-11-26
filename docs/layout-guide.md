# Laying out a diagram

Trace lays diagrams out by itself. This guide is for the moment it does not look right: what to try,
in what order, and why. Every rule below comes from a real diagram, the three-tier network behind a
DMZ (`examples/cases/dmz.trace`, with its plain version in `examples/cases/simple/`).

The aim is a diagram that reads as one picture: the main flow in one direction, links that go
straight, zones that touch where the real network touches, roughly page-shaped.

## 1. Start with the plain version

Write nodes, links, labels and frames. Nothing else. Look at it before adding anything.

```
frame dmz "DMZ" { lb: Load balancer
                  rp: Reverse proxy }
```

Most diagrams are fine at this point. The rest of this guide is for the ones that are not.
Do not add a command to a diagram that is already good: every command is something to maintain.

## 2. Choose the direction by the shape of the story

| The diagram is | Use |
|---|---|
| a pipeline, a lifecycle, a chain of steps (CI/CD, order processing, payment states) | `direction right` (the default) |
| layers or tiers that traffic crosses in order (a network behind firewalls, a request path through zones) | `direction down` |

If the plain version is a strip more than about 4 times wider than tall, the engine already folds it
into rows by itself. If you would rather decide, `direction down` is usually the better move for
layered things: the plain DMZ went from 2,872 by 281 px to 641 by 1,397 with this one line.

## 3. Put sibling nodes across the flow, not along it

This is the rule that fixed the DMZ, and the one most likely to apply to your next diagram.

A `column` stacks nodes top to bottom, a `row` side by side. When several nodes sit next to a zone's
entry point and all link on to the same place, they should be laid **across** the flow:

- in a `direction down` diagram, siblings go in a **row**;
- in a `direction right` diagram, siblings go in a **column**.

Why: nodes stacked *along* the flow stand in each other's way. The link from the first one cannot go
straight to what is beyond, so it leaves sideways, runs round the zone and comes back: the long,
jogging links you see when a left-to-right diagram is turned top-down without changing its stacks.
Across the flow, every node has a clear line.

Symptom: a link that leaves a box by the side, runs a long way, and turns back in.
Fix: change that `column` to a `row` (or the other way round).

## 4. Let zones follow the flow; draw the border with `[bridge]`

Frames are placed in the order the traffic crosses them, so with the direction right, four zones in a
chain come out as four bands one after the other. You do not need a `row` or `column` around them:
the DMZ with an outer `column` had 54 link bends, without it 25.

Where a firewall or gateway belongs to two zones, tag it `[bridge]`. It is drawn on the border,
half in each zone, and the two frames are made to touch. `[span]` makes a node as wide (or tall) as
the stack it links to, so the links fan out on straight lines.

`[span]` also fixes links that squeeze together. Two sources side by side feeding one node (the Internet
users and Partner APIs feeding DDoS scrubbing) are further apart than the node is wide, so their
links slide inward and bunch up at its edge. Tag the node `[span]` and it grows as wide as the row of
sources, with one attachment point under each: both links drop straight. A span node is sized to the
stack it *feeds*; a wider stack on the other side attaches in proportion and its links may jog.

Some links will still have one step. That is fine: what matters is that the steps are minimal (one
each) and aligned (links into the same node step at the same height), and the engine does both.

Both need the zones to be next to each other along the flow. If the two zones end up beside each
other in a row or column block, a bridge between them has no shared border and is drawn as an
ordinary node.

## 5. Use rows and columns of frames to decide, not to repeat

A `row` or `column` that holds frames places them side by side or one above the other, in the order
you write them. Use it when you want something the flow would not give you: two zones next to each
other (a grid), or a particular order.

- To **centre** things over what they feed (two sources either side of the first node, say), put them
  and the thing they feed in a `column` block. A column centres its children on each other; without
  it the layout may let one source drop straight and shift the other, since either is equally short
  for it. The price is a bend in each link where the sources are further apart than the node.
- A block that repeats what the flow already does (a `column` of zones in a top-down diagram) adds
  nothing and can make the result worse. Take it out and compare.
- Links that cross between blocks pay for it: the app zone beside the DMZ instead of below it turned
  two straight links into two long detours.

Symptom: long links between two zones that sit in different rows or columns.
Fix: put those two zones one after the other along the flow instead.

- To keep one pair level across two stacks of different lengths (an order and its invoice, a topic
  and its main consumer), write `align a b`. The stacks are slid into line on that pair and the link
  between them is one straight line. It costs a few bends in the other links between the two stacks,
  and it does not remove crossings, so use it for neatness of a pair, not as a fix for a tangle.

- To make zones or nodes line up, write `same-width zoneA zoneB zoneC` (or `same-height`). It is a
  statement about relations, not a number: it keeps working when a label changes, and the frames
  share their edges as well as their size. Use it when the tiers of a diagram have ragged sides.
- For links that touch many nodes and carry no part of the main story (logs to a SIEM, metrics to
  monitoring, a scheduler's triggers), use a `rail` on the side of the diagram those nodes are on. The
  links leave the layout, so the diagram looks as it did before they were added. Choose the side so the
  nodes that tap on are near it: a firewall at the right edge of a top-down diagram suits `[right]`; a
  node in the middle would have to cross its neighbours (the result tells you).

- For zones that watch or administer the rest (observability, admin access, security tooling), tag the frame
  `[side]` (and `span` to make it as tall as the zones it talks to): it stands beside the flow instead of
  becoming the last tier. Plain frames cannot tell a logging sink from a data tier, because both are the end of
  some links.

## 6. Reading a result

| What you see | What it means | Try |
|---|---|---|
| A strip many times wider than tall, text tiny at page width | too many steps in a row | `direction down`, or let it fold; or rows of frames |
| A link that leaves a box sideways and comes back | siblings stacked along the flow | swap `column` and `row` (section 3) |
| A long link looping round the whole diagram | a link written against the order of the nodes | declare the nodes in flow order, or use `<-` |
| Two links that slide inward and bunch up at a node | the sources are further apart than the node is wide | tag the node `[span]` |
| A firewall floating between two zones | the zones do not touch | `[bridge]`, and make them follow each other along the flow |
| Four or more links with the same label to one node (token checks, health pings) | merged by the engine into one bus with the label once; nothing to do. Different labels stay separate links |
| Many links to one monitoring or logging node spoil the picture | control-plane links mixed with the main flow | put that node in a `rail` |
| Zones beside each other that should be stacked | a layout block you do not need | remove it |
| Nodes that all look the same | nothing marks what they are | an icon, `[firewall]`, `[database]` |

Links keep clear of frame borders by themselves (a stretch within 8px of a border moves to 12px). Two
cases stay: a link that leaves its node already running along a border, and a link between two nodes that
both sit on the same border.

## 7. Many links into one node

Ten links into one node read as a tangle. Four answers, from the least to the most written:

- **Same label, nothing to write:** four or more links with the same label and style to or from one node are
  drawn as one bus, the label written once.
- **Put the senders in a zone:** when five or more of them stand in one zone the node is not in (the services
  that all validate a token, the devices behind one switch), the engine gathers them on a bar inside the zone,
  and only one link crosses its edge. A zone round the group, and a `row` or `column` so the members line up
  along the bar, is often all it takes (the home network case).
- **Fewer than four, written:** tag the node `[join]` (a gate after a parallel stage, a log collector) and two or
  three links that look the same meet a line with a dot, then one arrow reaches it.
- **`mark` the node** when the links say no more than “uses it” and it is not what the diagram is about
  (feature flags, a shared library): the links are no longer drawn, each sender carries the node's icon, and
  a legend line explains it. Not for a node whose links carry their own labels, nor for the subject of the
  diagram.

## 8. Things that are not layout, and are always worth doing

- **Ports and protocols on the links**: `lb -> fw2 : 443/tcp`. They cost nothing and make a network
  diagram worth reading.
- **Icons** for recognisable elements, left of the text; `top` for tall, narrow nodes. Not on
  decisions or states.
- **Technology logos** when the reader cares what a part is built with: `[database postgresql]` keeps the
  role icon and writes “PostgreSQL” with its logo under the name; `[kubernetes]` on a zone. A logo alone
  (`[go]`) when the technology is the point.
- **Frames named for what they are**, with the address range or owner in the title.

## 9. Checklist

1. Write the plain version and look at it.
2. Pick the direction (down for tiers, right for pipelines).
3. Stack siblings across the flow.
4. Let zones follow the flow; tag borders with `[bridge]`.
5. Only then add layout blocks, and only for what the flow cannot do.
6. Check the shape: roughly page-shaped, links straight, no detours.
7. Many links into one node: give them one label, gather the senders in a zone, or `mark` the node.
8. Add labels, ports, icons and logos.

## The DMZ, step by step

| Step | Size | Link bends |
|---|---|---|
| Icons and zones, direction right, no layout blocks | 2,872 x 281 | 25 |
| Plain version, `direction down` only | 641 x 1,397 | 18 |
| Zones as a 2 x 2 grid (rows and columns) | 1,688 x 626 | 58 |
| Top-down, app and data side by side | 910 x 1,316 | 69 |
| Top-down, app and data side by side, stacks as rows | 1,602 x 1,080 | 56 |
| Top-down, stacks as rows, one column of zones (layout block) | 786 x 1,282 | 54 |
| The same without the layout block around the zones | 786 x 1,168 | 25 |
| Sources centred over the first zone (a column block holding them and that zone) | 795 x 1,220 | 44 |
| The node they feed is a `[span]`, so both links drop straight | 830 x 1,224 | 30 |

The last two versions are the plain top-down diagram with rows inside the zones, icons, `[bridge]` and
`[span]`, the last with the sources centred. They are the best looking. (The plain version has fewer bends but its firewalls are
ordinary boxes inside the zones, and its nodes are stacked along the flow.)
