# The Trace language

One statement per line. `#` starts a comment (outside quotes, at line start or after a space).

## Whole-diagram settings

```
direction down        # right (default, also lr) or down (also td, tb)
spacing 1.3           # multiplies layout spacing, 0.5 to 3
title "Job states"    # used as the SVG's aria-label and the download file name
```

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

`<-` is the main layout tool: `pg <- worker` keeps the worker on the far side of Postgres while the
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
