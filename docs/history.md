# How Trace got here

1. The starting point: a set of diagrams for the user's docs, drawn by hand in one consistent SVG
   style. Hand work gave good results but did not scale. Question: can a small text language
   produce drawings like these?
2. Existing options were weighed, D2 being the closest off the shelf (classes, grid layouts, ELK).
   The conclusion was a small language built around the user's own visual grammar, with ELK for
   layout and a lot of post-processing.
3. First playground: parser, ELK layout, renderer, seven examples ported from the docs.
4. User feedback, in order, and what it produced:
   - “The Router block should be tall, matching the blocks it links to” → `[span]`, column titles,
     one width per column.
   - “Network boundaries reads left to right and looks weird” → top-down example, `[bridge]`,
     frames that hug their content, strip compaction under bridges.
   - “Make ~10 real-world diagrams, with complex networks” → `examples/cases/`; fixes for
     frames swallowing foreign nodes, frame titles under boxes, self-loops, labels
     clipped at the edge, span links straightened.
5. Renamed from “Tracé” to Trace (no accent) when moving to Claude Code.

Published page from that conversation (a claude.ai artifact, may be private to the user):
- Playground: https://claude.ai/artifact/UyWYevFBxieJjwBuVxg1bV

The user's next intended step was frame placement hints (roadmap item 1).
