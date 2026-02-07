---
title: "Contextual Retrieval Improvements for AI V4 Workflow"
sidebar_label: "Retrieval Improvements"
sidebar_position: 4
---

# Contextual Retrieval Improvements for AI V4 Workflow

Based on [Anthropic's Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) research, this document outlines improvements to our AI V4 hybrid query resolver.

## Expected Improvements

| Technique | Improvement |
|-----------|-------------|
| Contextual Embeddings | 35% failure reduction |
| + Contextual BM25 | 49% failure reduction |
| + Reranking | 67% failure reduction |

---

## 1. Contextual Code Chunks

### Problem
Current BM25 search indexes raw code snippets without context. When a chunk like:

```typescript
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = req.validatedBody
  const result = await service.create(data)
  res.json(result)
}
```

...is retrieved, it lacks information about:
- Which module/entity it belongs to
- What the endpoint does
- Related entities and relationships

### Solution

Create a **context generation script** that preprocesses code files:

```typescript
// src/scripts/generate-contextual-index.ts

interface ContextualChunk {
  filePath: string
  originalContent: string
  context: string  // Generated 50-100 tokens
  contextualContent: string  // context + originalContent
  module: string
  entityType: string
  apiPath?: string
}

async function generateChunkContext(
  chunk: string,
  filePath: string,
  documentContent: string
): Promise<string> {
  const prompt = `<document>
${documentContent}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
${chunk}
</chunk>

Please provide a short, succinct context (50-100 tokens) to situate this chunk
within the overall document. Focus on:
1. Which Medusa module/entity this relates to
2. What operation or functionality it implements
3. Key relationships to other entities

Answer ONLY with the context, nothing else.`

  const response = await generateWithHaiku(prompt)
  return response
}
```

### Context Generation Prompt (Optimized for Code)

```
<document>
{full_file_content}
</document>

Here is the code chunk we want to situate:
<chunk>
{chunk_content}
</chunk>

Provide succinct context (50-100 tokens) for this code chunk. Include:
1. Module name and entity type (e.g., "Design module, POST endpoint")
2. What this code does (e.g., "Creates a new design with specifications")
3. Related entities (e.g., "Links to Partner and Customer")
4. API path if applicable (e.g., "/admin/designs")

Answer ONLY with the context.
```

---

## 2. Hybrid BM25 + Embedding Search

### Current State
- BM25 only for code search
- MCP for core Medusa docs (no embedding)

### Proposed Architecture

```
User Query
    │
    ├─── BM25 Search ────────────┐
    │    (lexical matching)      │
    │                            ├──► Rank Fusion ──► Top 100 candidates
    └─── Embedding Search ───────┘
         (semantic similarity)
```

### Implementation

```typescript
// src/mastra/services/hybrid-search.ts

interface SearchResult {
  filePath: string
  chunk: string
  bm25Score: number
  embeddingScore: number
  fusedScore: number
}

export async function hybridSearch(
  query: string,
  options: { topK?: number; alpha?: number } = {}
): Promise<SearchResult[]> {
  const { topK = 100, alpha = 0.5 } = options

  // 1. BM25 Search (current implementation)
  const bm25Results = bm25Search(query, projectRoot, topK * 2)

  // 2. Embedding Search (new)
  const queryEmbedding = await embedQuery(query)
  const embeddingResults = await pgVectorSearch(queryEmbedding, topK * 2)

  // 3. Rank Fusion (Reciprocal Rank Fusion)
  const fusedResults = reciprocalRankFusion(bm25Results, embeddingResults, alpha)

  return fusedResults.slice(0, topK)
}

function reciprocalRankFusion(
  bm25: SearchResult[],
  embedding: SearchResult[],
  alpha: number = 0.5,
  k: number = 60
): SearchResult[] {
  const scores = new Map<string, number>()

  // BM25 contribution
  bm25.forEach((result, rank) => {
    const score = (1 - alpha) / (k + rank + 1)
    scores.set(result.filePath, (scores.get(result.filePath) || 0) + score)
  })

  // Embedding contribution
  embedding.forEach((result, rank) => {
    const score = alpha / (k + rank + 1)
    scores.set(result.filePath, (scores.get(result.filePath) || 0) + score)
  })

  // Sort by fused score
  return Array.from(scores.entries())
    .map(([filePath, fusedScore]) => ({
      filePath,
      fusedScore,
      // ... other fields
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore)
}
```

---

## 3. Reranking Step

### Problem
Initial retrieval returns 100+ candidates, many irrelevant. Sending all to LLM wastes tokens.

### Solution
Add a fast reranking step using Haiku to score relevance:

```typescript
// src/mastra/services/reranker.ts

interface RerankResult {
  chunk: string
  originalScore: number
  rerankScore: number
  finalScore: number
}

export async function rerankChunks(
  query: string,
  chunks: SearchResult[],
  topK: number = 20
): Promise<RerankResult[]> {
  // Take top 100-150 from initial retrieval
  const candidates = chunks.slice(0, 150)

  // Batch rerank using Haiku (fast, cheap)
  const prompt = `Given the user query and code chunks, score each chunk's relevance from 0-10.

Query: "${query}"

Chunks:
${candidates.map((c, i) => `[${i}] ${c.chunk.slice(0, 500)}`).join('\n\n')}

Return JSON array of scores: [{"index": 0, "score": 8}, ...]
Only include chunks with score >= 5.`

  const response = await generateWithHaiku(prompt)
  const scores = JSON.parse(response)

  // Combine with original scores
  const reranked = scores
    .map((s: { index: number; score: number }) => ({
      ...candidates[s.index],
      rerankScore: s.score,
      finalScore: candidates[s.index].fusedScore * 0.3 + s.score * 0.7
    }))
    .sort((a, b) => b.finalScore - a.finalScore)

  return reranked.slice(0, topK)
}
```

---

## 4. Contextual BM25 Index

### Current State
BM25 indexes raw file content.

### Improvement
Index the **contextualized content** instead:

```typescript
// Update bm25-code-search.ts

function buildContextualIndex(projectRoot: string): BM25Index {
  const files = glob.sync('src/**/*.ts', { cwd: projectRoot })
  const documents: ContextualDocument[] = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')

    // Load pre-generated context (from step 1)
    const contextFile = `${file}.context.json`
    const context = loadContext(contextFile)

    // Index the contextualized content
    documents.push({
      path: file,
      content: `${context.summary}\n\n${content}`,
      module: context.module,
      entityType: context.entityType,
    })
  }

  return buildBM25Index(documents)
}
```

---

## 5. Updated AI V4 Workflow

### Before (Current)
```
Query → Detect Entities → BM25 Search (10 results) → LLM Analysis → Execute → Respond
```

### After (With Contextual Retrieval)
```
Query → Detect Entities
    │
    ├─► Hybrid Search (BM25 + Embeddings)
    │       └─► 100+ candidates
    │
    ├─► Rerank with Haiku
    │       └─► Top 20 candidates
    │
    └─► LLM Analysis (with contextualized chunks)
            │
            ├─► Execute Plan
            │
            └─► Generate Response
```

---

## 6. Implementation Phases

### Phase 1: Contextual Indexing (Offline)
1. Create `generate-contextual-index.ts` script
2. Process all route files, services, and modules
3. Store context in `.context.json` files alongside source
4. Run once, update on code changes

### Phase 2: Contextual BM25
1. Update `bm25-code-search.ts` to use contextual content
2. Test retrieval quality improvement

### Phase 3: Hybrid Search
1. Set up PgVector for embeddings (already have infrastructure)
2. Implement embedding generation for chunks
3. Implement rank fusion
4. A/B test BM25-only vs hybrid

### Phase 4: Reranking
1. Implement Haiku-based reranker
2. Tune batch size and scoring threshold
3. Measure token savings vs quality

---

## 7. Cost Analysis

Using prompt caching (per Anthropic's benchmarks):
- Context generation: ~$1.02 per million tokens
- One-time indexing cost for our codebase (~500 files): ~$0.50-1.00
- Reranking per query: ~$0.001 (Haiku, small prompt)

---

## 8. Metrics to Track

1. **Retrieval Accuracy**: % of queries where correct file is in top-10
2. **Execution Success Rate**: % of queries that execute without errors
3. **Token Efficiency**: Tokens used per successful query
4. **Latency**: Time from query to response
5. **User Satisfaction**: Thumbs up/down on responses

---

## 9. Quick Win: Context Generation Prompt

Here's an optimized prompt for our Medusa codebase:

```
<document>
{file_content}
</document>

<chunk>
{chunk_content}
</chunk>

You are analyzing a Medusa 2.x e-commerce codebase. Provide a short context (50-100 tokens) for this code chunk. Include:

1. **Module**: Which Medusa module (design, partner, order, etc.)
2. **Type**: Endpoint, service, model, workflow, or subscriber
3. **Operation**: What this code does (create, list, update, delete, etc.)
4. **Entities**: Related entities and relationships
5. **API Path**: If an endpoint, include the path

Format: "[Module: X | Type: Y | Op: Z] Brief description. Related: A, B, C."

Example output:
"[Module: Design | Type: POST Endpoint | Op: Create] Creates a new design with specifications and colors. Validates input with Zod schema, links to Partner via design-partners-link. Related: DesignSpecifications, DesignColors, Partner."

Answer ONLY with the context.
```

---

## 10. Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/scripts/generate-contextual-index.ts` | Offline context generation |
| `src/mastra/services/contextual-search.ts` | Hybrid search with context |
| `src/mastra/services/reranker.ts` | Haiku-based reranking |
| `src/mastra/services/hybrid-query-resolver.ts` | Update to use new services |
| `.contextual-index/` | Store generated contexts |

---

## Summary

By implementing contextual retrieval:
1. **Contextual chunks** → 35% better retrieval
2. **Hybrid BM25 + embeddings** → Additional 14% improvement
3. **Reranking** → Additional 18% improvement
4. **Combined** → Up to 67% reduction in retrieval failures

This translates to more accurate query resolution, fewer execution errors, and better user experience in the AI V4 chat.
