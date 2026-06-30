# Token Usage Integration Test Plan

## Objective

Measure whether OpenCodeRAG saves or costs tokens by comparing RAG-on vs RAG-off
across real coding queries against the indexed OpenCodeRAG codebase (876 chunks,
170 files).

## Method

### Phase 1: Retrieval quality check

For each query, run `retrieve()` with the real embedder and store, measure:
- Number of results returned
- Top relevance score
- Whether the retrieval actually finds relevant code

### Phase 2: Projection

Using measured injection overhead + typical agent behavior estimates:
- Without RAG: agent makes ~2-3 extra `read` calls per query (~1200 tok each)
- With RAG: agent gets context upfront, fewer reads

Compute net token savings = (saved read tokens) - (injected context tokens).

## Benchmark Queries

1. "How does the retrieval pipeline work end-to-end?"
2. "How does the plugin auto-inject context into messages?"
3. "How does the keyword index combine with vector search?"
4. "Where is the embedder factory defined?"
5. "Where is the LanceDB store implementation?"
6. "Find all usages of the retrieve function"
7. "Find all usages of SearchResult type"
8. "How does the chunker factory register new languages?"
9. "What is the default minScore configuration?"
10. "How does the session logger capture token usage?"

## Output

- `doc/eval-token-report.md` — formatted report with measurements and verdict
- Console output during test execution
