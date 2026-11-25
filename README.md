# Trace

Write diagrams as plain text; get them drawn like a careful hand would.

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
