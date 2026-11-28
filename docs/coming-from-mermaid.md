# Coming from Mermaid

Trace works like Mermaid's flowcharts: you write nodes and links, and the layout is automatic. The differences are
in what you can say about the drawing.

## The same diagram in both

<table>
<tr><th>Mermaid</th><th>Trace</th></tr>
<tr>
<td valign="top">

```
flowchart TD
  user([Customer])
  subgraph web[web]
    app[Shop app<br/>Node.js]
  end
  db[(Orders DB)]
  user -->|HTTPS| app
  app -->|orders| db
```

</td>
<td valign="top">

```
direction down
pill user [user]: Customer
frame web "web" [blue] {
  app [server]: Shop app | Node.js
}
store db [database]: Orders DB
user -> app : HTTPS
app -> db : orders
```

</td>
</tr>
</table>

## Side by side

| Mermaid | Trace |
|---|---|
| `flowchart TD` / `LR` | `direction down` / `right` (the default) |
| `A[Label]` | `a: Label` |
| `A[Label<br/>more]` | `a: Label \| more` (a muted line under the name) |
| `A([Label])`, `A[(Label)]`, `A{Label}` | `pill a: Label`, `store a: Label`, `ask a: Label?` (kinds say what a node is) |
| `A --> B`, `A -.-> B`, `A --- B`, `A <--> B` | `a -> b`, `a --> b`, `a -- b`, `a <-> b` |
| `A -->\|label\| B` | `a -> b : label` |
| `subgraph x [Title] … end` | `frame x "Title" { … }` |
| `classDef`, `style`, `linkStyle` | tags that mean something: `[ok]`, `[bad]`, `[dashed]`, `[muted]`, zone colours |
| `%% comment` | `# comment` |
| `sequenceDiagram` | `sequence` |
| `architecture-beta` icons | `[icon]` from Lucide, `[postgresql]` and other logos |

## What Trace adds

Hints that say where things go, when the automatic layout is not what you want: rows and columns, a firewall on a
zone's border (`[bridge]`), zones beside the flow (`[side]`), links gathered on one line, `align`, `same-width`,
legends, titles, link labels at each end, and notes on any node, zone or link (Mermaid has notes only in its
sequence, state and class diagrams). See part 2 of the [manual](manual.md).

## What Trace leaves out

Node shapes beyond its kinds, free colours and styles, and Mermaid's other diagram types (class, Gantt, pie, git
graph, timeline and so on): Trace is for diagrams of things and the links between them.

## Converting a Mermaid diagram

```
node tools/mermaid-to-trace.js diagram.mmd > diagram.trace
```

It converts flowcharts, sequence diagrams and `architecture-beta`: nodes, links, labels and subgraphs, with no
layout hints. Styling is dropped. Then add hints where the drawing needs them.
