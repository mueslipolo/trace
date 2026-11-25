# Handover

State on 2026-11-25. `main` has everything; nothing is waiting on another branch. Read `CLAUDE.md` first, then
this, then `docs/roadmap.md` for the backlog.

## Where things stand

- **Tests:** `npm test` runs 113 tests (parse, layout invariants for every example, the simple forms, the
  showcase and features pages, and targeted tests per feature). All pass.
- **Examples:** 11 playground examples, 20 showcase cases (each in a full and a simple form), 25 feature pairs.
- **Pages:** `npm run build` writes `dist/playground.html`, `dist/showcase.html` (the 20 cases, simple and full),
  `dist/features.html` (every feature drawn without and with it, as a manual) and `dist/compare.html` (the
  held-out diagrams, Trace beside Mermaid).
- **Pushed:** the owner pushes; the last commits on `main` may not be on the remote yet. Old local branches are
  all merged into `main` and can be deleted (`git branch --merged main`).

## How the work has been done

The owner directs, item by item, and judges results by eye in the showcase and the features page. What has
worked:

- **Look before you claim.** After any change to `src/trace.js`: `npm test`, then render the PNGs of the cases
  you touched and of the ones near them (`node tools/render.js examples/cases/dmz.trace /tmp/x.png --zoom 1`) and
  look at them. Most bugs were only visible in a picture.
- **Check the pages in a browser engine.** Node tests cannot see browser-only failures (the fold once read
  `process.env` and broke every wide diagram in the pages). Two ways that work in the sandbox:
  - jsdom, with `elk.bundled.js` evaluated in the window and `tools/measure.js` as the canvas: count the
    `.canvas` slots that hold an `<svg>`.
  - headless Chromium (`sudo apt-get install -y chromium`, then `chromium --headless --no-sandbox
    --virtual-time-budget=60000 --screenshot=out.png file://...`). Replace the jsDelivr elkjs URL with a
    `file://` path to `node_modules/elkjs/lib/elk.bundled.js` first.
- **Design questions: mockups first, the owner decides, then build.** For anything visual (icons, rails,
  side zones) the owner wants to see options drawn on a real diagram before any engine work, and to choose.
  Several of my first proposals were rejected that way, rightly. The mockups were deleted once decided; they
  are in git history (`docs/mockups/`, removed in 95403c3).
- **Keep what is better, not what is new.** When a feature is applied to the showcase, compare old and new
  renders and keep only the improvements (side zones helped 2 cases of 6; the other 4 are recorded below).
- **Principle from the owner:** easy things easy (write nodes and links, the layout is automatic, like
  Mermaid), hard things possible (layout blocks and tags for when you want to decide).

## The engine in one page

`src/trace.js` is the whole engine: parser, layout (via ELK), post-layout passes, SVG renderer. Details are
in `docs/architecture.md`; what follows is the order things happen in, which is where most surprises come
from.

1. **Parse** (`parse`). Ends with `desugarSides`: frames tagged `[side]` are moved, and the rest of the
   diagram is wrapped, into layout blocks (lanes) on either side of the main flow.
2. **Choose a layout** (`chooseLayout`). Several candidates (per frame, flat, compound, ELK wrapping, cycle
   breaking by declaration order), scored by bends plus a penalty for width over 1,100 px. With layout blocks
   only the per-frame layout applies; if it cannot place the diagram, the blocks are ignored and the result
   says so ("could not be placed in the rows and columns you wrote").
3. **Finish** (in `layout`), on the chosen layout, in this order: `spanSides` (side zones that span),
   `clearFrames` (links off frame borders), `alignJogs`, `simplifySnakes`, `mergeHubs` (four or more links
   with one label into a bus), `separateParallels` (links closer than 8 px pulled to 12), `spreadEnds` (link
   ends on one side of a node kept apart), `placeLabels`.
4. **Fold** (`foldCandidate`): a strip wider than 3.5:1 and 1,500 px is retried as rows of its top-level
   items, and kept only when it is clearly better (less width, no more crossings, at most 15% more bends, no
   more labels crossed, no link returning more than 30% of the width).
5. **Render.**

`compile(src, measure, ELK, { off: [...] })` switches tidy-ups off: `wrap`, `fold`, `merge`, `tidy`. The
features page uses it to draw "without". Environment switches for Node: `TRACE_LAYOUT`, `TRACE_NOWRAP`,
`TRACE_NOCYCLE`, `TRACE_NOFOLD`, `TRACE_DEBUG`.

## Recently built (last sessions)

- **Metrics and the held-out set** (`npm run metrics`, `examples/holdout/`): 19 real C4 and Mermaid diagrams,
  never tuned on; a layout change is kept only if they do not get worse. `tools/mermaid-to-trace.js` converts a
  Mermaid diagram plainly (nodes, links, labels, subgraphs, no layout help). `dist/compare.html`
  (`npm run build:compare`) draws each held-out diagram with Trace and with Mermaid side by side.
- **Routing rules from the reviews** (`docs/drawing-rules.md`): no link through or brushing a node, no two links
  on top of each other, rerouting never adds crossings, hops where links cross.

- **Side zones:** `[side]`, `[side left|right|top|bottom]`, `[span]` on a top-level frame (language.md,
  "Side zones"). Several per side, both sides, nested frames, root nodes, rails. Used by the DMZ case (SIEM)
  and the data platform (orchestration). Tests in `test/fixtures/side*.trace`.
- **Features page** (`tools/build-features.js`, `examples/features/`): one box size, scaled down, never up;
  each feature as Write / Use it when / drawings / What changes.
- **Link tidy-ups:** merged links (bus), parallel links pulled apart, arrowheads kept apart, short sides
  sharing their room.
- **Nine more showcase cases** (OAuth sequence, shop ER model, org chart, AWS VPC, ML pipeline, triage,
  home network, CQRS, monorepo), each with an honest note of what is still weak.
- **Engine fixes:** ELK throwing on some table layouts is caught; a stub ending inside a block crashed.

## Decisions taken with the owner

- **Rails are superseded by side zones.** The rail idea was right, its drawing was not (a heavy band, a title
  crossed by a link, the label repeated). `rail` still works; nothing new should build on it.
- **Bundling cannot replace "out of the layout".** Tested on the DMZ: bundled links still pull the layout. Side
  zones solve it with placement instead.
- **Side zones:** only the two sides across the flow exist; `span` is the look the owner chose (option B).
- **Fold:** conservative on purpose. A fold of a chain always adds one long return link; the real answer is
  a snake (rows flowing alternately), not built.
- **Merging links:** automatic at four or more links with the same label and style, only when there is room
  for the arrowheads (46 px gap). No off switch in the language yet.
- **Side zones rejected for** zero-trust and office (the zone ends up far from what it serves), hub and CQRS
  (the wrapped layout is worse). Recorded so nobody retries them blindly.

## Open, in rough order of value

1. Done since this was written: title (always drawn, the owner's choice), `caption`, `cartouche`.
2. **A bus in the gutter:** three or more links from the main flow into one side-zone node arrive side by
   side; joining them in one line along the gutter was mocked up and liked (the "thin bus").
3. **Links to a zone with layout blocks:** a link that names a frame disables the per-frame layout, so with
   side zones it is refused with a message. Supporting it would allow "the cluster is scraped" with one arrow.
4. **Links from the middle of a row to a side zone:** the neighbours are in the way and the per-frame layout
   gives up (`portFor` returns no port). Route through the gap between rows instead.
5. **A platform case for the showcase** (services, data, observability and admin on the sides): attempted,
   left out because of 3 and 4.
6. **Views** (C4-style): one model, several diagrams (runtime, observability, admin). The owner liked the idea
   as the long-term answer to overloaded diagrams; not designed in detail.
7. **Layout recommendations:** analyse a diagram and suggest the layout features to use (rows, columns,
   align, side zones), applied one by one or tried automatically and compared. The owner wants it, later.
8. **Layout speed on large diagrams:** the full GitLab component diagram (about 80 links) takes over four
   minutes in Node. Find which pass is slow (likely the router or the candidate layouts) before adding it to
   the held-out set.
9. **Held-out weak spots:** OpenTelemetry services (19 crossings, 82 bends: the flagd fan-in), online-boutique
   (two links on top of each other).
10. Smaller: an `agent` dot on nodes (for "an agent runs on every VM"), a snake for folds, an off switch for
   merging, splitting `trace.js` into modules, syntax highlighting in the playground.

## Housekeeping

- `package-lock.json` is now committed (npm writes it on install).
- Scratch work went to the session scratchpad, not the repo. `test/fixtures/` holds the side-zone scenarios.
- The sandbox had Chromium installed for checks; a new sandbox will not have it.
