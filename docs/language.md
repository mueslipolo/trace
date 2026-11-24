# The Trace language

One statement per line. `#` starts a comment (outside quotes, at line start or after a space).

## Whole-diagram settings

```
direction down        # right (default, also lr) or down (also td, tb)
spacing 1.3           # multiplies layout spacing, 0.5 to 3
title "Job states"    # used as the SVG's aria-label and the download file name
```

## Layout is automatic

When a diagram does not look right yet, `docs/layout-guide.md` says what to try, in order.

Write nodes and links and nothing else: the layout is automatic. A long chain such as
`a -> b -> c -> ...` folds into rows by itself when it would otherwise be a strip more than four times
wider than tall; zones (frames) are placed around their members; you never have to say where anything
goes. Rows and columns of frames (see Blocks) are there for the cases where you want to decide.

## Nodes

```
[kind] name [tags] : Bold label | muted note
```

- `name` is the id: letters, digits, `_ . -`, starting with a letter, digit or `_`.
- Without a label the name is shown. `\n` breaks a line; long text wraps on its own
  (names at about 210px, notes at 230px).
- Declaring a node again merges: a later line can add a kind, label or tags, and moves the node
  into the block it is declared in.
- A node first mentioned in a link is created where that link is written.

Kinds:

| kind | drawn as |
|---|---|
| `box` | default rounded rectangle |
| `store` | yellow, for databases, buckets, topics |
| `engine` | grey fill, for external engines and systems |
| `state` | more rounded, for state machines |
| `pill` | fully rounded, for people and external actors |
| `ask` | fully rounded, for decisions (write the `?` yourself) |
| `start` | filled dot |
| `final` (alias `end`) | double border, for terminal states |

Icons: any word in the brackets that is not a tag below names an icon, drawn left of the text:

```
pill users [user]: Internet users
fw [firewall]: Edge firewall | stateful, geo-block
lb [loadbalancer top]: Load balancer pair | VRRP
```

- The names are the common diagram elements below, plus every Lucide icon under its own name
  (lucide.dev/icons), for example `brick-wall-fire` or `cable`. `lucide/bridge` names the Lucide icon
  `bridge`, since `bridge` alone is the tag.
- `top` puts the icon above the text instead; the node gets taller instead of wider.
- Icons are drawn in the diagram's ink colour whatever the node's state.
- A name that does not exist is an error with a line number and close matches.
- The drawings of the common names ship with the engine. Any other Lucide icon is fetched from
  jsDelivr the first time a diagram uses it (Node reads it from `src/lucide.js`). If that fails, for
  example offline, the node is drawn without its icon and the result carries a warning.
- Common names: database, server, user, cloud, browser, queue, firewall, storage, loadbalancer,
  container, api, lock, mobile, internet, router, switch, wifi, vpn, dns, shield, laptop, monitor,
  printer, camera, cache, function, clock, document, bell, chart, settings, mail, key.
  `examples/playground/icons.trace` draws them all with the Lucide name each one comes from.

Tags (in brackets, before the colon or at the end of the label):

| tag | effect |
|---|---|
| `ok` / `bad` | green / red border |
| `dashed` | dashed border (planned, optional, retired) |
| `muted` | soft grey border |
| `span` | grows to the full height (direction right) or width (down) of the column or row it links to; one connection point per member, so each link runs straight |
| `bridge` | sits on the border between its frame and the frame of a node linking into it, with the two frames widened into bands; for firewalls, gateways, anything on two networks |

## Links

```
a -> b : label [tags]
a -> b -> c            # chains; a label applies to every link of the chain
```

| operator | meaning |
|---|---|
| `->` | arrow |
| `-->` | dashed arrow |
| `<-` | arrow into the left node, but the layout still places the right node after it |
| `<--` | dashed version of `<-` |
| `<->` | arrowheads at both ends |
| `--` | no arrowhead |

You can write a link either way round: when a link points back against the order you declared the
nodes in, the layout treats it as a feedback link and keeps the main flow straight. `<-` is for when
you want to say so yourself, and is the main layout tool: `pg <- worker` keeps the worker on the far side of Postgres while the
arrow points at Postgres; `fw <- proxy` sends traffic back up without the layout turning around.

Link tags: `ok`, `bad`, `muted` (colour), `dashed`.

## Blocks

```
frame id "Title" [colour] {
  ...
}
column "optional title" {
  ...
}
row "optional title" {
  ...
}
```

- `frame` draws a titled zone. Colours: `green` (default), `blue`, `orange`, `purple`, `grey`;
  `dashed` also works. Frames nest. The id is optional; links can name a frame id.
- `column` stacks nodes top to bottom, `row` side by side. They hold nodes only. Links between
  members run straight inside the stack. Stacks across the flow (columns when the direction is
  right) give every member the same width. Sibling stacks of the same length share slot sizes,
  so they line up row for row like a table.
- A title in quotes on a column or row is drawn as a small header above it.
- A row or column that holds **frames** (or other rows and columns) is a layout block: it places them
  side by side (row) or one above the other (column), in the order you write them, and draws nothing
  itself. Nest them for a grid. Links still decide the details inside each block; the block decides
  who is next to whom. It takes no title (put the title on a frame).

```
column {
  row {
    frame edge "edge" { ... }
    frame dmz "DMZ" { ... }
  }
  row {
    frame app "app zone" { ... }
    frame data "data zone" { ... }
  }
}
```

  Inside a layout block the flow runs along the block (a row left to right, a column downwards), whatever
  the diagram's `direction`. A `[bridge]` only works between frames that share a border along the diagram's
  direction, so a firewall between two rows is an ordinary node. Layout blocks need the per-frame layout;
  if the diagram cannot be placed that way, the blocks are ignored and the result carries a warning.

## Rails

```
rail logs "management VLAN" [right] {
  siem: SIEM | log collection
}
fw1 -> logs : 514/udp
fw2 -> siem : 514/udp
```

A rail is a band along one edge of the whole diagram for links that touch many nodes: logging, monitoring,
scheduling. The nodes inside it are where the links end; a link to the rail's name or to a node in it
is a rail link. Each runs from its node straight to a bus line on the rail, and the bus feeds the nodes
with an arrow. Rail links take no part in the layout, so adding a rail never moves anything else.

- `[top]`, `[bottom]`, `[left]` or `[right]` picks the edge (default: bottom for a diagram that flows
  right, right for one that flows down). A colour (`[grey]`, `[blue]` ...) and `[dashed]` work as on frames.
- A rail goes at the top level and holds nodes only.
- A link crosses whatever lies between its node and the rail, so a rail suits nodes near the edge it runs
  along. When a link would cross another node, the result carries a warning saying which.

## Aligning two nodes

```
align tPay payment
```

Puts two linked nodes in different rows or columns level: the stacks are brought into line on them and
the link between them is drawn as one straight line. They need a link between them (`tPay -> payment`),
and each pair of stacks can have one such pair. `align a b c` keeps `a` with `b` and `b` with `c`. If it
cannot be done without touching another node, the diagram is left as laid out and says so.

Use it for a clear one-to-one pair between two stacks of different lengths, such as an order and its
invoice. It does not reduce crossings: a fan of links between two stacks crosses the same way level or not.

## Legend

```
key box [dashed] : planned
key -> [bad] : failure path
key final : terminal state
key frame [orange] : DMZ
```

Shape is any node kind, `frame`, or an arrow (`->`, `-->`, `--`). Keys are laid out in a row under
the diagram.

## Errors

Every problem is reported with its line number and what to write instead; the playground lists
them under the editor and keeps showing the last good drawing, faded.
