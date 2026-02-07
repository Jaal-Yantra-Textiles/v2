/**
 * Graph RAG Service
 *
 * Implements graph-based retrieval augmented generation using Mastra's GraphRAG class.
 * Creates a knowledge graph from module specs where:
 * - Nodes represent entities (module specs)
 * - Edges represent relations and links between entities
 *
 * Phase 4 Enhancement: Enables relationship traversal for complex queries
 * that span multiple entities.
 */

// @ts-nocheck
import { GraphRAG } from "@mastra/rag"
import {
  embedText,
  embedTexts,
  EMBEDDING_CONFIG,
} from "./embedding-service"
import { planStoreLogger as log } from "./logger"

// ─── Configuration ───────────────────────────────────────────────────────────

// Graph RAG similarity threshold for creating edges
const GRAPH_THRESHOLD = parseFloat(process.env.AI_V3_GRAPH_THRESHOLD || "0.6")

// Number of random walk steps for graph traversal
const GRAPH_WALK_STEPS = parseInt(process.env.AI_V3_GRAPH_WALK_STEPS || "100", 10)

// Embedding dimension - explicitly a number to avoid any type issues
const GRAPH_EMBEDDING_DIM = parseInt(process.env.AI_V3_GRAPH_EMBEDDING_DIM || "384", 10)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphChunk {
  id: string
  content: string
  metadata: {
    type: "entity" | "relation" | "link"
    module: string
    entityName?: string
    source?: string
    target?: string
    relationName?: string
    cardinality?: string
  }
}

export interface GraphEmbedding {
  id: string
  vector: number[]
}

export interface GraphRAGResult {
  id: string
  content: string
  metadata: Record<string, any>
  score: number
}

// ─── Module Spec Types (matches spec-store.ts) ───────────────────────────────

interface ModuleSpec {
  moduleName: string
  dataModel: {
    entityName: string
    properties: Array<{
      name: string
      type: string
      required: boolean
      description?: string
    }>
    relations: Array<{
      name: string
      targetEntity: string
      cardinality: "one-to-one" | "one-to-many" | "many-to-many"
      description?: string
    }>
  }
  integrationPoints: {
    links: Array<{
      targetModule: string
      targetEntity: string
      linkField: string
      description?: string
    }>
  }
  apiEndpoints?: Array<{
    path: string
    method: string
    description?: string
  }>
}

// ─── Graph Instance ─────────────────────────────────────────────────────────

let graphRAGInstance: GraphRAG | null = null
let graphInitialized = false

// ─── Spec Loading ───────────────────────────────────────────────────────────

/**
 * Load all module specs from the specs directory
 */
async function loadAllSpecs(): Promise<Map<string, ModuleSpec>> {
  const specs = new Map<string, ModuleSpec>()

  try {
    // Dynamic import to avoid circular dependencies
    const fs = await import("fs/promises")
    const path = await import("path")

    const specsDir = path.join(process.cwd(), "specs")

    // Check if specs directory exists
    try {
      await fs.access(specsDir)
    } catch {
      log.warn("Specs directory not found, using empty graph", { specsDir })
      return specs
    }

    // Read all JSON files from specs directory
    const files = await fs.readdir(specsDir)
    const jsonFiles = files.filter(f => f.endsWith(".json"))

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(specsDir, file), "utf-8")
        const spec = JSON.parse(content) as ModuleSpec

        if (spec.moduleName) {
          specs.set(spec.moduleName, spec)
        }
      } catch (error) {
        log.warn("Failed to load spec file", { file, error: String(error) })
      }
    }

    log.info("Loaded module specs for graph", { count: specs.size })
  } catch (error) {
    log.error("Failed to load specs", { error: String(error) })
  }

  return specs
}

/**
 * Build searchable text from a module spec
 */
function buildSearchableText(spec: ModuleSpec): string {
  const parts: string[] = [
    spec.moduleName,
    spec.dataModel.entityName,
  ]

  // Add properties
  for (const prop of spec.dataModel.properties) {
    parts.push(`${prop.name} ${prop.type}`)
    if (prop.description) parts.push(prop.description)
  }

  // Add relations
  for (const rel of spec.dataModel.relations) {
    parts.push(`${rel.name} ${rel.targetEntity} ${rel.cardinality}`)
    if (rel.description) parts.push(rel.description)
  }

  // Add links
  for (const link of spec.integrationPoints.links) {
    parts.push(`${link.targetModule} ${link.targetEntity}`)
    if (link.description) parts.push(link.description)
  }

  return parts.filter(Boolean).join(" ")
}

// ─── Graph Initialization ───────────────────────────────────────────────────

/**
 * Initialize the GraphRAG instance from module specs
 */
export async function initGraphRAG(): Promise<GraphRAG> {
  if (graphRAGInstance && graphInitialized) {
    return graphRAGInstance
  }

  log.operationStart("Initialize Graph RAG")

  try {
    // 1. Load all specs
    const specs = await loadAllSpecs()

    if (specs.size === 0) {
      log.warn("No specs found, creating empty graph")
      graphRAGInstance = new GraphRAG({
        dimension: GRAPH_EMBEDDING_DIM,
        threshold: GRAPH_THRESHOLD,
      })
      graphInitialized = true
      return graphRAGInstance
    }

    // 2. Build chunks from specs + relations + links
    const chunks: GraphChunk[] = []
    const textsToEmbed: string[] = []

    for (const [name, spec] of specs) {
      // Main entity chunk
      const entityContent = buildSearchableText(spec)
      chunks.push({
        id: `spec_${name}`,
        content: entityContent,
        metadata: {
          type: "entity",
          module: name,
          entityName: spec.dataModel.entityName,
        },
      })
      textsToEmbed.push(entityContent)

      // Relation chunks (edges)
      for (const rel of spec.dataModel.relations) {
        const relContent = `${spec.dataModel.entityName} has ${rel.cardinality} relation to ${rel.targetEntity} via ${rel.name}. ${rel.description || ""}`
        chunks.push({
          id: `rel_${name}_${rel.name}`,
          content: relContent,
          metadata: {
            type: "relation",
            module: name,
            source: name,
            target: rel.targetEntity,
            relationName: rel.name,
            cardinality: rel.cardinality,
          },
        })
        textsToEmbed.push(relContent)
      }

      // Link chunks (cross-module references)
      for (const link of spec.integrationPoints.links) {
        const linkContent = `${spec.dataModel.entityName} is linked to ${link.targetEntity} in ${link.targetModule} via ${link.linkField}. ${link.description || ""}`
        chunks.push({
          id: `link_${name}_${link.targetEntity}`,
          content: linkContent,
          metadata: {
            type: "link",
            module: name,
            source: name,
            target: link.targetModule,
            entityName: link.targetEntity,
          },
        })
        textsToEmbed.push(linkContent)
      }
    }

    log.info("Built graph chunks", {
      totalChunks: chunks.length,
      entities: specs.size,
      relations: chunks.filter(c => c.metadata.type === "relation").length,
      links: chunks.filter(c => c.metadata.type === "link").length,
    })

    // 3. Generate embeddings
    const rawVectors = await embedTexts(textsToEmbed)

    // Validate and normalize embeddings
    const embeddings: GraphEmbedding[] = rawVectors.map((rawVector, i) => {
      let vector: number[]
      if (Array.isArray(rawVector)) {
        vector = rawVector.map(v => (typeof v === "number" && Number.isFinite(v) ? v : 0))
      } else if (rawVector && typeof rawVector === "object" && "values" in rawVector) {
        vector = (rawVector as any).values.map((v: any) =>
          typeof v === "number" && Number.isFinite(v) ? v : 0
        )
      } else {
        log.warn("Invalid embedding format at index", { index: i })
        vector = new Array(GRAPH_EMBEDDING_DIM).fill(0)
      }

      // Ensure correct dimension
      if (vector.length !== GRAPH_EMBEDDING_DIM) {
        if (vector.length < GRAPH_EMBEDDING_DIM) {
          vector = [...vector, ...new Array(GRAPH_EMBEDDING_DIM - vector.length).fill(0)]
        } else {
          vector = vector.slice(0, GRAPH_EMBEDDING_DIM)
        }
      }

      return { id: chunks[i].id, vector }
    })

    // 4. Create graph
    log.info("Creating GraphRAG instance", {
      dimension: GRAPH_EMBEDDING_DIM,
      threshold: GRAPH_THRESHOLD,
      embeddingCount: embeddings.length,
    })

    graphRAGInstance = new GraphRAG({
      dimension: GRAPH_EMBEDDING_DIM,
      threshold: GRAPH_THRESHOLD,
    })

    graphRAGInstance.createGraph(chunks, embeddings)
    graphInitialized = true

    log.info("Graph RAG initialized successfully", {
      chunks: chunks.length,
      threshold: GRAPH_THRESHOLD,
    })

    return graphRAGInstance
  } catch (error) {
    log.error("Failed to initialize Graph RAG", { error: String(error) })

    // Create empty graph as fallback
    graphRAGInstance = new GraphRAG({
      dimension: GRAPH_EMBEDDING_DIM,
      threshold: GRAPH_THRESHOLD,
    })
    graphInitialized = true

    return graphRAGInstance
  }
}

/**
 * Reset the graph (useful for testing or when specs change)
 */
export function resetGraphRAG(): void {
  graphRAGInstance = null
  graphInitialized = false
  log.info("Graph RAG reset")
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Query the graph with semantic search and graph traversal
 */
export async function queryGraphRAG(
  query: string,
  topK: number = 10,
  randomWalkSteps: number = GRAPH_WALK_STEPS
): Promise<GraphRAGResult[]> {
  log.operationStart("Query Graph RAG", { query: query.slice(0, 50), topK })

  try {
    const graph = await initGraphRAG()

    // Generate query embedding
    const rawEmbedding = await embedText(query)

    // Validate and normalize the embedding to ensure it's a proper number array
    let queryEmbedding: number[]
    if (Array.isArray(rawEmbedding)) {
      queryEmbedding = rawEmbedding.map(v =>
        typeof v === "number" && Number.isFinite(v) ? v : 0
      )
    } else if (rawEmbedding && typeof rawEmbedding === "object" && "values" in rawEmbedding) {
      // Handle case where embedding is returned as { values: number[] }
      queryEmbedding = (rawEmbedding as any).values.map((v: any) =>
        typeof v === "number" && Number.isFinite(v) ? v : 0
      )
    } else {
      log.error("Invalid embedding format", { type: typeof rawEmbedding })
      return []
    }

    // Validate embedding dimension
    if (queryEmbedding.length !== GRAPH_EMBEDDING_DIM) {
      log.warn("Embedding dimension mismatch", {
        expected: GRAPH_EMBEDDING_DIM,
        actual: queryEmbedding.length,
      })
      // Pad or truncate to match expected dimension
      if (queryEmbedding.length < GRAPH_EMBEDDING_DIM) {
        queryEmbedding = [...queryEmbedding, ...new Array(GRAPH_EMBEDDING_DIM - queryEmbedding.length).fill(0)]
      } else {
        queryEmbedding = queryEmbedding.slice(0, GRAPH_EMBEDDING_DIM)
      }
    }

    // Query with graph traversal
    const results = graph.query({
      query: queryEmbedding,
      topK,
      randomWalkSteps,
      restartProb: 0.15, // Standard PageRank restart probability
    })

    log.info("Graph RAG query complete", {
      resultsCount: results.length,
      topScore: results[0]?.score,
    })

    return results
  } catch (error) {
    log.error("Graph RAG query failed", { error: String(error) })
    return []
  }
}

/**
 * Find related entities for a given entity via graph traversal
 */
export async function findRelatedEntities(
  entityName: string,
  maxDepth: number = 2
): Promise<{
  entity: string
  relationType: "relation" | "link"
  path: string[]
}[]> {
  log.operationStart("Find Related Entities", { entityName, maxDepth })

  try {
    // Query for the entity and its connections
    const results = await queryGraphRAG(
      `${entityName} relations links connected to`,
      20,
      200 // More walk steps for deeper traversal
    )

    // Extract unique related entities
    const related: Map<string, { relationType: "relation" | "link"; path: string[] }> = new Map()

    for (const result of results) {
      const metadata = result.metadata
      const type = metadata.type as "entity" | "relation" | "link"

      if (type === "relation" && metadata.target) {
        if (!related.has(metadata.target)) {
          related.set(metadata.target, {
            relationType: "relation",
            path: [metadata.source, metadata.relationName, metadata.target],
          })
        }
      } else if (type === "link" && metadata.target) {
        if (!related.has(metadata.target)) {
          related.set(metadata.target, {
            relationType: "link",
            path: [metadata.source, "linked_to", metadata.target],
          })
        }
      }
    }

    const relatedList = Array.from(related.entries()).map(([entity, info]) => ({
      entity,
      ...info,
    }))

    log.info("Found related entities", {
      entity: entityName,
      relatedCount: relatedList.length,
    })

    return relatedList
  } catch (error) {
    log.error("Failed to find related entities", { error: String(error) })
    return []
  }
}

/**
 * Get graph statistics
 */
export async function getGraphStats(): Promise<{
  initialized: boolean
  nodeCount: number
  entityCount: number
  relationCount: number
  linkCount: number
  threshold: number
}> {
  try {
    if (!graphInitialized || !graphRAGInstance) {
      return {
        initialized: false,
        nodeCount: 0,
        entityCount: 0,
        relationCount: 0,
        linkCount: 0,
        threshold: GRAPH_THRESHOLD,
      }
    }

    // We need to query to understand the graph size
    // This is a workaround since GraphRAG doesn't expose node count directly
    const allResults = await queryGraphRAG("*", 1000, 50)

    const entityCount = allResults.filter(r => r.metadata.type === "entity").length
    const relationCount = allResults.filter(r => r.metadata.type === "relation").length
    const linkCount = allResults.filter(r => r.metadata.type === "link").length

    return {
      initialized: true,
      nodeCount: allResults.length,
      entityCount,
      relationCount,
      linkCount,
      threshold: GRAPH_THRESHOLD,
    }
  } catch (error) {
    log.error("Failed to get graph stats", { error: String(error) })
    return {
      initialized: graphInitialized,
      nodeCount: 0,
      entityCount: 0,
      relationCount: 0,
      linkCount: 0,
      threshold: GRAPH_THRESHOLD,
    }
  }
}

/**
 * Build context string from graph results for LLM
 */
export function buildGraphContextForLLM(results: GraphRAGResult[], maxResults: number = 5): string {
  if (results.length === 0) {
    return ""
  }

  const contextLines: string[] = [
    "## Related Entities (via Graph Traversal)",
    "",
  ]

  const topResults = results.slice(0, maxResults)

  for (const result of topResults) {
    const type = result.metadata.type
    const score = result.score.toFixed(2)

    if (type === "entity") {
      contextLines.push(`- **${result.metadata.entityName}** (module: ${result.metadata.module}, relevance: ${score})`)
    } else if (type === "relation") {
      contextLines.push(`- ${result.metadata.source} → ${result.metadata.relationName} → ${result.metadata.target} (${result.metadata.cardinality}, relevance: ${score})`)
    } else if (type === "link") {
      contextLines.push(`- ${result.metadata.source} linked to ${result.metadata.target} (cross-module, relevance: ${score})`)
    }
  }

  contextLines.push("")

  return contextLines.join("\n")
}
