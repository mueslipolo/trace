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

## 6. Reading a result

| What you see | What it means | Try |
|---|---|---|
| A strip many times wider than tall, text tiny at page width | too many steps in a row | `direction down`, or let it fold; or rows of frames |
| A link that leaves a box sideways and comes back | siblings stacked along the flow | swap `column` and `row` (section 3) |
| A long link looping round the whole diagram | a link written against the order of the nodes | declare the nodes in flow order, or use `<-` |
| A firewall floating between two zones | the zones do not touch | `[bridge]`, and make them follow each other along the flow |
| Zones beside each other that should be stacked | a layout block you do not need | remove it |
| Nodes that all look the same | nothing marks what they are | an icon, `[firewall]`, `[database]` |

## 7. Things that are not layout, and are always worth doing

- **Ports and protocols on the links**: `lb -> fw2 : 443/tcp`. They cost nothing and make a network
  diagram worth reading.
- **Icons** for recognisable elements, left of the text; `top` for tall, narrow nodes. Not on
  decisions or states.
- **Frames named for what they are**, with the address range or owner in the title.

## 8. Checklist

1. Write the plain version and look at it.
2. Pick the direction (down for tiers, right for pipelines).
3. Stack siblings across the flow.
4. Let zones follow the flow; tag borders with `[bridge]`.
5. Only then add layout blocks, and only for what the flow cannot do.
6. Check the shape: roughly page-shaped, links straight, no detours.
7. Add labels, ports and icons.

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

The last two versions are the plain top-down diagram with rows inside the zones, icons, `[bridge]` and
`[span]`, the last with the sources centred. They are the best looking. (The plain version has fewer bends but its firewalls are
ordinary boxes inside the zones, and its nodes are stacked along the flow.)
