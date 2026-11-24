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
npm run build        # dist/playground.html (live editor), dist/showcase.html (the ten cases)
node tools/render.js examples/cases/dmz.trace dmz.svg
```

Language: `docs/language.md`. How it works: `docs/architecture.md`. What's next: `docs/roadmap.md`.
