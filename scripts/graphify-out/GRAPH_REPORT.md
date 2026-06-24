# Graph Report - .  (2026-06-24)

## Corpus Check
- Corpus is ~2,351 words - fits in a single context window. You may not need a graph.

## Summary
- 40 nodes · 36 edges · 9 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Build UI CSS|Build UI CSS]]
- [[_COMMUNITY_Dedup Chunks|Dedup Chunks]]
- [[_COMMUNITY_Release Minor (Shell)|Release Minor (Shell)]]
- [[_COMMUNITY_Release Patch (Shell)|Release Patch (Shell)]]

## God Nodes (most connected - your core abstractions)
1. `release_minor.sh script` - 3 edges
2. `release_patch.sh script` - 3 edges
3. `dedupKey()` - 2 edges
4. `main()` - 2 edges
5. `run()` - 2 edges
6. `die()` - 2 edges
7. `run()` - 2 edges
8. `die()` - 2 edges
9. `__dirname` - 1 edges
10. `root` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "Build UI CSS"
Cohesion: 0.18
Nodes (9): bin, __dirname, hljsDst, inputFile, outputFile, root, themeDst, themeSrc (+1 more)

### Community 1 - "Dedup Chunks"
Cohesion: 0.29
Nodes (7): args, ChunkInfo, dbPath, dbPathIdx, dedupKey(), dryRun, main()

### Community 2 - "Release Minor (Shell)"
Cohesion: 0.83
Nodes (3): release_minor.sh script, die(), run()

### Community 3 - "Release Patch (Shell)"
Cohesion: 0.83
Nodes (3): release_patch.sh script, die(), run()

## Knowledge Gaps
- **14 isolated node(s):** `__dirname`, `root`, `uiDir`, `inputFile`, `outputFile` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `__dirname`, `root`, `uiDir` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._