# Trace

Write diagrams as plain text; get them drawn like a careful hand would.

Trace keeps what people love in Mermaid (a diagram is code, it is easy to write, and the layout is automatic)
and adds what it lacks to look good. Two promises:

- **With no help, at least as good as Mermaid.** Write nodes and links only and the automatic layout must
  read at least as well as Mermaid's drawing of the same diagram.
- **With a few hints, the next level.** Rows and columns, `[span]`, `[bridge]`, side zones, `align`, `mark`,
  `[join]`, `tree`, icons and logos: each is optional, each says something the engine cannot guess, and
  together they give a drawing a careful hand would make.

Both are checked on real diagrams: `npm run build:compare` draws every held-out diagram three ways, as first
written, with hints, and by Mermaid.

```
frame api "api process" {
  router: FastAPI app | and Router
}
column {
  store pg: Postgres
  store s3: S3 bucket | files/ and jobs/
}
client -> router : HTTPS REST, API key
router -> pg : create job and attempt
pg <- worker : claim, lease, outcome
```

```
npm install
npm test
npm run build        # dist/playground.html (live editor), dist/showcase.html (twenty real cases),
                     # dist/features.html (every feature with and without), dist/compare.html (Trace beside Mermaid)
npm run metrics      # layout quality over the examples and a held-out set of real diagrams
node tools/render.js examples/cases/dmz.trace dmz.svg
```

Language: `docs/language.md`. Drawing a diagram well: `docs/layout-guide.md`. How it works:
`docs/architecture.md`. The rules behind the layout: `docs/drawing-rules.md`. What's next: `docs/roadmap.md`.

Icons are Lucide's (ISC) and technology logos Simple Icons' (CC0; the logos are trademarks of their owners),
see `third-party/`.
