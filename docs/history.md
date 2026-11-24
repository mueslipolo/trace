# How Trace got here

1. The user had redrawn every Mermaid diagram of their docs by hand, in one consistent SVG style
   (`reference/docs-diagrams-redrawn.html`, SVGs in `reference/hand-drawn-svgs/`). Mermaid's output
   was “ugly and limited”; the redraws were not, but took hand work. Question: can a Mermaid-style
   language produce drawings like these?
2. Existing options were weighed: D2 (closest off the shelf: classes, grid layouts, ELK) and
   Mermaid with themes. The conclusion was a small language built around the user's own visual
   grammar, with ELK for layout and a lot of post-processing.
3. First playground: parser, ELK layout, renderer, seven examples ported from the docs.
4. User feedback, in order, and what it produced:
   - “The Router block should be tall, matching the blocks it links to” → `[span]`, column titles,
     one width per column.
   - “Network boundaries reads left to right and looks weird” → top-down example, `[bridge]`,
     frames that hug their content, strip compaction under bridges.
   - “Make ~10 real-world diagrams, with complex networks, and compare with Mermaid” →
     `examples/cases/` and the comparison page; fixes for frames swallowing foreign nodes, frame
     titles under boxes, self-loops, labels clipped at the edge, span links straightened.
5. Renamed from “Tracé” to Trace (no accent) when moving to Claude Code.

Published pages from that conversation (claude.ai artifacts, may be private to the user):
- Playground: https://claude.ai/artifact/UyWYevFBxieJjwBuVxg1bV
- Mermaid vs Trace, ten cases: https://claude.ai/artifact/5dGFth4LRuPXVkUtScY6et
- Original hand-drawn redraws: https://claude.ai/artifact/YWHApsErhSCkBXqimsq9ab

The user's next intended step was frame placement hints (roadmap item 1).
