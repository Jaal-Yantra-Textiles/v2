/**
 * Hybrid Query Resolver Service
 *
 * Combines BM25 code search with LLM analysis to resolve natural language queries
 * into executable Medusa 2.x code.
 *
 * Key routing logic:
 * 1. Detect entities from user query using entity-registry
 * 2. For CORE Medusa entities (order, product, customer, collection, etc.):
 *    - Query Medusa MCP server for API documentation
 *    - Generate execution plan using MCP context
 * 3. For CUSTOM entities (design, partner, person, etc.):
 *    - Use BM25 code search to find relevant files
 *    - Generate execution plan using code context
 *
 * Used by AI Chat workflow as the primary query resolution mechanism.
 */

import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { MedusaContainer } from "@medusajs/framework"
import { getModuleListForPrompt } from "./module-registry"
// Entity registry for detecting and classifying entities
import {
  detectEntities,
  getEntityConfig,
  isCustomEntity,
  getCoreEntities,
  getCustomEntities,
  CoreEntityConfig,
  CustomEntityConfig,
} from "../schema/entity-registry"
// Medusa MCP for core entity documentation
import { queryMedusaDocs } from "./medusa-mcp-client"
import { queryMedusaMCP, buildAPIContextForPlanner } from "./medusa-mcp"

// Contextual Index for enhanced retrieval (based on Anthropic's Contextual Retrieval)
import {
  ContextualIndexService,
  type ContextualSearchResult,
} from "./contextual-index"
import { rerankChunks, type SearchResult as RerankSearchResult } from "./reranker"

// BM25 parameters
const K1 = 1.5
const B = 0.75

// Search directories relative to project root
const SEARCH_DIRS = ["src/modules", "src/api", "src/workflows", "src/links"]

// Pre-indexed docs paths
const SPECS_DIR = "specs"

interface SearchHit {
  file: string
  line: number
  content: string
  term: string
}

interface FileScore {
  file: string
  score: number
  hits: SearchHit[]
  snippet: string
}

export interface ExecutionStep {
  step: number
  action: string
  method: "service" | "graph" | "api" | "javascript"
  code: string
  output: string
  explanation: string
}

/**
 * Clarification option when multiple modules/entities match a query
 */
export interface ClarificationOption {
  id: string
  label: string
  description: string
  module: string
  apiPath?: string
  keywords?: string[]
}

/**
 * Clarification context provided by user after selecting an option
 */
export interface ClarificationContext {
  selectedOptionId: string
  selectedModule: string
  originalQuery: string
}

export interface ResolvedQuery {
  query: string
  targetEntity: string
  mode: "data" | "analysis" | "create" | "update" | "chat"
  patterns: string[]
  executionPlan: ExecutionStep[]
  codeContext?: string
  confidence: number
  resolvedAt: Date
  source: "indexed" | "bm25_llm" | "mcp_generic" | "fallback" | "contextual_bm25_llm"
  // Human-in-the-loop fields
  needsClarification?: boolean
  clarificationMessage?: string
  clarificationOptions?: ClarificationOption[]
}

export interface HybridResolverOptions {
  useIndexedFirst?: boolean
  maxSearchResults?: number
  llmModel?: string
  llmApiKey?: string
  projectRoot?: string
  // Human-in-the-loop: clarification from previous interaction
  clarification?: ClarificationContext
  // Contextual Retrieval (Anthropic research): 35-67% improvement in retrieval accuracy
  useContextualIndex?: boolean
  useReranker?: boolean
}

// ============================================================================
// BM25 Search Implementation
// ============================================================================

function extractSearchTerms(query: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "show", "me", "get", "pull", "find", "list", "what", "which", "their",
    "them", "those", "this", "that", "these", "many", "much", "any", "and",
    "but", "if", "or", "how", "all", "each", "few", "more", "most", "other"
  ])

  const terms = query
    .toLowerCase()
    .replace(/[^\w\s_-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t))

  const variations: string[] = []
  for (const term of terms) {
    variations.push(term)
    variations.push(term.charAt(0).toUpperCase() + term.slice(1))
    if (!term.endsWith("s")) variations.push(term + "s")
    variations.push(term + "_id")
  }

  for (let i = 0; i < terms.length - 1; i++) {
    variations.push(`${terms[i]}_${terms[i + 1]}`)
  }

  return [...new Set(variations)]
}

function grepSearch(term: string, dirs: string[], projectRoot: string): SearchHit[] {
  const hits: SearchHit[] = []

  for (const dir of dirs) {
    const fullPath = path.join(projectRoot, dir)
    if (!fs.existsSync(fullPath)) continue

    const result = spawnSync("grep", ["-r", "-n", "-i", "--include=*.ts", term, fullPath], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })

    const output = result.stdout || ""
    for (const line of output.split("\n")) {
      if (!line.trim()) continue
      if (line.includes(".test.ts") || line.includes(".spec.ts") || line.includes("__tests__")) continue

      const match = line.match(/^([^:]+):(\d+):(.*)$/)
      if (match) {
        hits.push({
          file: match[1].replace(projectRoot + "/", ""), // Relative path
          line: parseInt(match[2], 10),
          content: match[3].trim(),
          term,
        })
      }
    }
  }

  return hits
}

function getFileLength(filePath: string): number {
  try {
    return fs.readFileSync(filePath, "utf-8").split("\n").length
  } catch {
    return 0
  }
}

function calculateBM25Score(
  file: string,
  fileHits: SearchHit[],
  stats: { totalDocs: number; avgDocLength: number; docLengths: Map<string, number>; termDocFreq: Map<string, number> },
  terms: string[]
): number {
  const docLength = stats.docLengths.get(file) || 1
  let score = 0

  const termFreq = new Map<string, number>()
  for (const hit of fileHits) {
    termFreq.set(hit.term, (termFreq.get(hit.term) || 0) + 1)
  }

  for (const term of terms) {
    const tf = termFreq.get(term) || 0
    if (tf === 0) continue

    const df = stats.termDocFreq.get(term) || 1
    const idf = Math.log((stats.totalDocs - df + 0.5) / (df + 0.5) + 1)
    const tfComponent = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * docLength / stats.avgDocLength))
    score += idf * tfComponent
  }

  // Boost relevant files
  if (file.includes("/models/")) score *= 1.5
  if (file.includes("/service")) score *= 1.3
  if (file.includes("/links/")) score *= 1.4
  if (file.includes("route.ts")) score *= 1.2

  return score
}

function extractSnippet(filePath: string, hits: SearchHit[], contextLines: number = 3): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")
    const hitLines = new Set(hits.map(h => h.line))
    const relevantLines = new Set<number>()

    for (const hitLine of hitLines) {
      for (let i = Math.max(1, hitLine - contextLines); i <= Math.min(lines.length, hitLine + contextLines); i++) {
        relevantLines.add(i)
      }
    }

    const sortedLines = [...relevantLines].sort((a, b) => a - b)
    const snippetLines: string[] = []
    let lastLine = 0

    for (const lineNum of sortedLines) {
      if (lastLine > 0 && lineNum > lastLine + 1) snippetLines.push("...")
      const prefix = hitLines.has(lineNum) ? ">>> " : "    "
      snippetLines.push(`${prefix}${lineNum}: ${lines[lineNum - 1]}`)
      lastLine = lineNum
    }

    return snippetLines.slice(0, 30).join("\n")
  } catch {
    return hits.map(h => `${h.line}: ${h.content}`).join("\n")
  }
}

function bm25Search(query: string, projectRoot: string, topK: number = 5): FileScore[] {
  const terms = extractSearchTerms(query)
  const allHits: SearchHit[] = []

  for (const term of terms) {
    allHits.push(...grepSearch(term, SEARCH_DIRS, projectRoot))
  }

  if (allHits.length === 0) return []

  const fileHits = new Map<string, SearchHit[]>()
  for (const hit of allHits) {
    if (!fileHits.has(hit.file)) fileHits.set(hit.file, [])
    fileHits.get(hit.file)!.push(hit)
  }

  const files = [...fileHits.keys()]
  const docLengths = new Map<string, number>()
  let totalLength = 0
  for (const file of files) {
    const length = getFileLength(path.join(projectRoot, file))
    docLengths.set(file, length)
    totalLength += length
  }

  const termDocFreq = new Map<string, number>()
  for (const [, hits] of fileHits) {
    const seenTerms = new Set(hits.map(h => h.term))
    for (const term of seenTerms) {
      termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1)
    }
  }

  const stats = {
    totalDocs: files.length,
    avgDocLength: files.length > 0 ? totalLength / files.length : 1,
    docLengths,
    termDocFreq,
  }

  const fileScores: FileScore[] = []
  for (const [file, hits] of fileHits) {
    const score = calculateBM25Score(file, hits, stats, terms)
    fileScores.push({
      file,
      score,
      hits,
      snippet: extractSnippet(path.join(projectRoot, file), hits),
    })
  }

  fileScores.sort((a, b) => b.score - a.score)
  return fileScores.slice(0, topK)
}

// ============================================================================
// LLM Analysis
// ============================================================================

async function callLLM(prompt: string, apiKey: string, model: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as any
    return data.choices[0].message.content
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === "AbortError") {
      throw new Error("LLM request timed out after 60 seconds")
    }
    throw error
  }
}

function buildLLMPrompt(query: string, codeSnippets: FileScore[], projectRoot: string = process.cwd()): string {
  const snippetsText = codeSnippets
    .map((s, i) => `--- File ${i + 1}: ${s.file} (score: ${s.score.toFixed(2)}) ---\n${s.snippet}`)
    .join("\n\n")

  // Get the list of available modules from modules-bindings.d.ts
  const moduleList = getModuleListForPrompt(projectRoot)

  return `You are analyzing a Medusa 2.x codebase to understand how to resolve a user query.

USER QUERY: "${query}"

${moduleList}

RELEVANT CODE SNIPPETS FROM BM25 SEARCH:
${snippetsText}

Based on these code snippets, analyze the query and generate:

1. **Target Entity**: What entity is the user asking about?
2. **Mode**: Is this data retrieval, analysis (count/stats), create, or update?
3. **Query Patterns**: 5-8 natural language variations of how users might ask this
4. **Execution Plan**: Step-by-step code to resolve this query

IMPORTANT RULES FOR EXECUTION PLAN:
- For model relations (defined WITHIN a module's models): Use service.list() with { relations: [...] }
- For module links (defineLink ACROSS modules): Use query.graph() - NEVER use relations!
- Service method naming: listDesigns, retrieveDesign, listAndCountDesigns (PascalCase entity name)
- Always use actual method names from the code snippets

CRITICAL: MODULE LINKS vs MODEL RELATIONS
In Medusa 2.x, cross-module relationships are MODULE LINKS, not model relations!
- Order -> Customer: MODULE LINK (use query.graph, NOT relations: ['customer'])
- Order -> Items: MODEL RELATION (use relations: ['items'])
- Design -> Customer: MODULE LINK (use query.graph)
- Design -> Specifications: MODEL RELATION (use relations: ['specifications'])

For MODULE LINKS (cross-module), use query.graph():
  await query.graph({ entity: 'orders', fields: ['*', 'customer.*'], filters: { ... } })

For MODEL RELATIONS (within module), use service with relations:
  await orderService.listOrders({}, { relations: ['items', 'shipping_address'] })

SERVICE METHOD SIGNATURE (CRITICAL - MUST FOLLOW EXACTLY):
Medusa services use TWO arguments: service.listEntities(FILTERS, CONFIG)
  - FIRST arg (FILTERS): WHERE conditions only (status, id, etc) - use {} if none
  - SECOND arg (CONFIG): order, take, skip, relations, select

CORRECT EXAMPLES:
  await orderService.listOrders({}, { order: { created_at: 'DESC' }, take: 20 })
  await orderService.listOrders({ status: 'pending' }, { take: 10, relations: ['items'] })
  await designService.listAndCountDesigns({}, { order: { created_at: 'DESC' } })
  await query.graph({ entity: 'orders', fields: ['*', 'customer.*'], filters: {}, pagination: { take: 20, order: { created_at: 'DESC' } } })

WRONG - DO NOT DO THIS:
  await orderService.listOrders({ order: { created_at: 'DESC' } })  // WRONG: order in filters
  await orderService.listOrders({ take: 20 })  // WRONG: take in filters
  await orderService.listOrders({}, { relations: ['customer'] })  // WRONG: customer is a module link!

The "order", "take", "skip", "relations", "select" keys MUST be in the SECOND argument, NEVER in the first!

SUPPORTED METHOD TYPES (use ONLY these):
- "service": For service calls like designService.listDesigns()
- "graph": For query.graph() calls with module links
- "javascript": For post-processing (counts, formatting, aggregation)

DO NOT use method types like "destructure", "format", "aggregate", "return" - convert these to "javascript".
For counts/aggregations, do it in a single "service" call using listAndCount, then use "javascript" for formatting.

Respond in JSON format:
{
  "targetEntity": "design",
  "mode": "data",
  "patterns": [
    "show me designs with their specifications",
    "get all designs including specifications"
  ],
  "executionPlan": [
    {
      "step": 1,
      "action": "query",
      "method": "service",
      "code": "await designService.listDesigns({}, { relations: ['specifications'] })",
      "output": "designs with specifications loaded",
      "explanation": "Fetches designs using service call with relations parameter"
    }
  ],
  "confidence": 0.95
}`
}

async function analyzeWithLLM(
  query: string,
  codeSnippets: FileScore[],
  apiKey: string,
  model: string
): Promise<Omit<ResolvedQuery, "resolvedAt" | "source">> {
  const prompt = buildLLMPrompt(query, codeSnippets)
  const llmResponse = await callLLM(prompt, apiKey, model)

  let jsonStr = llmResponse.trim()
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
  }

  try {
    const parsed = JSON.parse(jsonStr)
    return {
      query,
      targetEntity: parsed.targetEntity || "unknown",
      mode: parsed.mode || "data",
      patterns: parsed.patterns || [],
      executionPlan: parsed.executionPlan || [],
      codeContext: codeSnippets.map(s => s.snippet).join("\n\n"),
      confidence: parsed.confidence || 0.5,
    }
  } catch {
    return {
      query,
      targetEntity: "unknown",
      mode: "data",
      patterns: [],
      executionPlan: [],
      codeContext: codeSnippets.map(s => s.snippet).join("\n\n"),
      confidence: 0,
    }
  }
}

// ============================================================================
// Pre-Indexed Lookup
// ============================================================================

interface IndexedRelation {
  name: string
  type: "hasMany" | "hasOne" | "belongsTo"
  target: string
}

interface IndexedModule {
  module: string
  model: string
  service: string
  relations: IndexedRelation[]
}

interface IndexedLink {
  name: string
  source: string
  target: string
  queryCapability: string
}

function loadPreIndexedDocs(projectRoot: string): {
  relations: { modules: IndexedModule[] } | null
  links: { links: IndexedLink[] } | null
} {
  const relationsPath = path.join(projectRoot, SPECS_DIR, "relations", "service-relations.json")
  const linksPath = path.join(projectRoot, SPECS_DIR, "links", "module-links.json")

  let relations: { modules: IndexedModule[] } | null = null
  let links: { links: IndexedLink[] } | null = null

  try {
    if (fs.existsSync(relationsPath)) {
      relations = JSON.parse(fs.readFileSync(relationsPath, "utf-8"))
    }
  } catch {}

  try {
    if (fs.existsSync(linksPath)) {
      links = JSON.parse(fs.readFileSync(linksPath, "utf-8"))
    }
  } catch {}

  return { relations, links }
}

function tryResolveFromIndex(
  query: string,
  relations: { modules: IndexedModule[] } | null,
  links: { links: IndexedLink[] } | null
): ResolvedQuery | null {
  if (!relations && !links) return null

  const lowerQuery = query.toLowerCase()

  // Simple entity detection
  const entityKeywords: Record<string, string[]> = {
    design: ["design", "designs"],
    partner: ["partner", "partners"],
    person: ["person", "persons", "people"],
    task: ["task", "tasks"],
    production_run: ["production run", "production_run", "production_runs"],
    visual_flow: ["visual flow", "visual_flow", "visual_flows"],
    feedback: ["feedback", "feedbacks"],
  }

  let targetEntity = ""
  for (const [entity, keywords] of Object.entries(entityKeywords)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
      targetEntity = entity
      break
    }
  }

  if (!targetEntity) return null

  // Check for relation patterns
  const relationPatterns = [
    /with\s+(?:their\s+)?(\w+)/gi,
    /including\s+(\w+)/gi,
    /have\s+(\w+)/gi,
  ]

  const wantedRelations: string[] = []
  for (const pattern of relationPatterns) {
    const matches = [...lowerQuery.matchAll(pattern)]
    for (const match of matches) {
      wantedRelations.push(match[1].toLowerCase())
    }
  }

  if (wantedRelations.length === 0) return null

  // Try to find in indexed relations
  if (relations) {
    const moduleDoc = relations.modules.find(m =>
      m.model.toLowerCase() === targetEntity ||
      m.module.toLowerCase().replace(/s$/, "") === targetEntity
    )

    if (moduleDoc) {
      for (const wantedRel of wantedRelations) {
        const relation = moduleDoc.relations.find(r =>
          r.name.toLowerCase() === wantedRel ||
          r.name.toLowerCase() === wantedRel + "s" ||
          r.name.toLowerCase() === wantedRel.replace(/s$/, "")
        )

        if (relation) {
          const serviceName = moduleDoc.service
          const listMethod = `list${moduleDoc.model}s`

          return {
            query,
            targetEntity,
            mode: "data",
            patterns: [`${targetEntity}s with ${relation.name}`],
            executionPlan: [{
              step: 1,
              action: "query",
              method: "service",
              code: `await ${serviceName}.${listMethod}({}, { relations: ['${relation.name}'] })`,
              output: `${targetEntity}s with ${relation.name}`,
              explanation: `Service relation: ${relation.type} to ${relation.target}`,
            }],
            confidence: 0.9,
            resolvedAt: new Date(),
            source: "indexed",
          }
        }
      }
    }
  }

  // Try to find in indexed links
  if (links) {
    for (const wantedRel of wantedRelations) {
      const link = links.links.find(l => {
        const sourceEntity = l.source.split(".")[0]
        const targetEntityFromLink = l.target.split(".")[0]
        return (
          (sourceEntity === targetEntity && targetEntityFromLink.includes(wantedRel)) ||
          (targetEntityFromLink === targetEntity && sourceEntity.includes(wantedRel))
        )
      })

      if (link) {
        return {
          query,
          targetEntity,
          mode: "data",
          patterns: [`${targetEntity}s with linked ${wantedRel}`],
          executionPlan: [{
            step: 1,
            action: "query",
            method: "graph",
            code: `await query.graph({ entity: '${targetEntity}s', fields: ['*', '${wantedRel}.*'] })`,
            output: `${targetEntity}s with linked ${wantedRel}`,
            explanation: `Module link: ${link.name}`,
          }],
          confidence: 0.85,
          resolvedAt: new Date(),
          source: "indexed",
        }
      }
    }
  }

  return null
}

// ============================================================================
// Ambiguity Detection for Human-in-the-Loop
// ============================================================================

/**
 * Map of ambiguous terms that could match multiple modules
 * Key: term that might appear in user query
 * Value: array of possible modules with metadata
 */
const AMBIGUOUS_TERMS: Record<string, ClarificationOption[]> = {
  campaign: [
    {
      id: "publishing_campaigns",
      label: "Publishing Campaigns",
      description: "Scheduled content publishing to social platforms (Instagram, Facebook)",
      module: "publishing_campaigns",
      apiPath: "/admin/publishing-campaigns",
      keywords: ["publish", "schedule", "content", "social", "instagram", "facebook", "post"],
    },
    {
      id: "meta_ads_campaigns",
      label: "Meta Ads Campaigns",
      description: "Facebook/Instagram advertising campaigns for paid marketing",
      module: "meta_ads",
      apiPath: "/admin/meta-ads/campaigns",
      keywords: ["ads", "advertising", "marketing", "paid", "budget", "spend", "impressions"],
    },
  ],
  ads: [
    {
      id: "meta_ads",
      label: "Meta Ads",
      description: "Facebook/Instagram advertising (ads, adsets, campaigns)",
      module: "meta_ads",
      apiPath: "/admin/meta-ads/ads",
      keywords: ["facebook", "instagram", "marketing", "advertising", "paid"],
    },
  ],
  leads: [
    {
      id: "meta_ads_leads",
      label: "Meta Ads Leads",
      description: "Leads generated from Meta advertising campaigns",
      module: "meta_ads",
      apiPath: "/admin/meta-ads/leads",
      keywords: ["ads", "advertising", "form", "conversion"],
    },
    {
      id: "form_responses",
      label: "Form Responses",
      description: "Responses from website forms and contact submissions",
      module: "forms",
      apiPath: "/admin/forms/[id]/responses",
      keywords: ["form", "submission", "contact", "website"],
    },
  ],
  posts: [
    {
      id: "social_posts",
      label: "Social Posts",
      description: "Published social media posts and their performance",
      module: "social_posts",
      apiPath: "/admin/social-posts",
      keywords: ["social", "instagram", "facebook", "published", "engagement"],
    },
  ],
  accounts: [
    {
      id: "social_platforms",
      label: "Social Platform Accounts",
      description: "Connected social media platform accounts (Instagram, Facebook)",
      module: "social_platforms",
      apiPath: "/admin/social-platforms",
      keywords: ["social", "instagram", "facebook", "connect", "platform"],
    },
    {
      id: "meta_ads_accounts",
      label: "Meta Ads Accounts",
      description: "Facebook/Instagram advertising accounts",
      module: "meta_ads",
      apiPath: "/admin/meta-ads/accounts",
      keywords: ["ads", "advertising", "business", "ad account"],
    },
  ],
  insights: [
    {
      id: "meta_ads_insights",
      label: "Meta Ads Insights",
      description: "Performance analytics for advertising campaigns",
      module: "meta_ads",
      apiPath: "/admin/meta-ads/insights",
      keywords: ["ads", "performance", "analytics", "spend", "reach"],
    },
    {
      id: "social_posts_insights",
      label: "Social Posts Insights",
      description: "Engagement metrics for social media posts",
      module: "social_posts",
      apiPath: "/admin/social-posts/[id]/sync-insights",
      keywords: ["social", "engagement", "likes", "comments", "reach"],
    },
  ],
  tasks: [
    {
      id: "tasks",
      label: "General Tasks",
      description: "Task management for designs, orders, and general work",
      module: "tasks",
      apiPath: "/admin/tasks",
      keywords: ["task", "work", "todo", "assign", "complete"],
    },
    {
      id: "design_tasks",
      label: "Design Tasks",
      description: "Tasks specifically linked to design production",
      module: "design",
      apiPath: "/admin/designs/[id]/tasks",
      keywords: ["design", "production", "create", "develop"],
    },
    {
      id: "partner_tasks",
      label: "Partner Tasks",
      description: "Tasks assigned to external partners/vendors",
      module: "partner",
      apiPath: "/admin/partners/[id]/tasks",
      keywords: ["partner", "vendor", "external", "assign"],
    },
  ],
  flows: [
    {
      id: "visual_flows",
      label: "Visual Flows",
      description: "Visual workflow automation editor",
      module: "visual_flows",
      apiPath: "/admin/visual-flows",
      keywords: ["visual", "editor", "automation", "workflow", "node"],
    },
  ],
}

/**
 * Detect if a query contains ambiguous terms that need clarification
 */
function detectAmbiguity(query: string): {
  isAmbiguous: boolean
  term?: string
  options?: ClarificationOption[]
  message?: string
} {
  const lowerQuery = query.toLowerCase()

  // Check for disambiguating context first
  // If user already specifies context, don't ask for clarification
  const contextKeywords = [
    { pattern: /\b(publish|schedule|content|social\s*media)\b/i, resolves: "publishing_campaigns" },
    { pattern: /\b(meta\s*ads?|facebook\s*ads?|instagram\s*ads?|advertising|paid|budget)\b/i, resolves: "meta_ads" },
    { pattern: /\b(design|production|specification|sku)\b/i, resolves: "design" },
    { pattern: /\b(partner|vendor|external|artisan)\b/i, resolves: "partner" },
    { pattern: /\b(visual|editor|automation|node)\b/i, resolves: "visual_flows" },
  ]

  // Check each ambiguous term
  for (const [term, options] of Object.entries(AMBIGUOUS_TERMS)) {
    // Check if the term appears in the query
    const termPattern = new RegExp(`\\b${term}s?\\b`, "i")
    if (!termPattern.test(lowerQuery)) continue

    // Check if context already disambiguates
    let disambiguated = false
    for (const ctx of contextKeywords) {
      if (ctx.pattern.test(lowerQuery)) {
        // Context matches one of the options
        const matchingOption = options.find(
          o => o.id === ctx.resolves || o.module === ctx.resolves
        )
        if (matchingOption) {
          disambiguated = true
          break
        }

        // Also check if keywords match
        for (const option of options) {
          const optionKeywordMatch = option.keywords?.some(kw =>
            lowerQuery.includes(kw.toLowerCase())
          )
          if (optionKeywordMatch) {
            disambiguated = true
            break
          }
        }
        if (disambiguated) break
      }
    }

    // If not disambiguated and multiple options exist, request clarification
    if (!disambiguated && options.length > 1) {
      return {
        isAmbiguous: true,
        term,
        options,
        message: `I found multiple types of "${term}" in your system. Which one are you asking about?`,
      }
    }
  }

  return { isAmbiguous: false }
}

/**
 * Apply clarification context to narrow down the query
 */
function applyClarificationContext(
  query: string,
  clarification: ClarificationContext
): { modifiedQuery: string; targetModule: string } {
  // Add the selected module context to help the LLM understand
  const modifiedQuery = `[Context: User is asking about ${clarification.selectedModule}] ${query}`
  return {
    modifiedQuery,
    targetModule: clarification.selectedModule,
  }
}

// ============================================================================
// Core Entity MCP Integration
// ============================================================================

/**
 * Classify detected entities into core and custom categories
 */
function classifyDetectedEntities(entities: string[]): {
  coreEntities: Array<{ name: string; config: CoreEntityConfig }>
  customEntities: Array<{ name: string; config: CustomEntityConfig }>
} {
  const coreEntities: Array<{ name: string; config: CoreEntityConfig }> = []
  const customEntities: Array<{ name: string; config: CustomEntityConfig }> = []

  for (const entity of entities) {
    const config = getEntityConfig(entity)
    if (!config) continue

    if (config.is_core) {
      coreEntities.push({ name: entity, config: config as CoreEntityConfig })
    } else {
      customEntities.push({ name: entity, config: config as CustomEntityConfig })
    }
  }

  return { coreEntities, customEntities }
}

/**
 * Get MCP documentation context for core entities
 * Queries the Medusa MCP server for API documentation
 */
async function getCoreEntityMCPContext(
  coreEntities: Array<{ name: string; config: CoreEntityConfig }>
): Promise<string> {
  if (coreEntities.length === 0) return ""

  const contextParts: string[] = [
    "## Medusa Core Entity API Documentation (from MCP)",
    ""
  ]

  // Try dynamic MCP first, fall back to static
  for (const { name, config } of coreEntities.slice(0, 3)) {
    try {
      // Try dynamic MCP client first
      const mcpResponse = await queryMedusaDocs(
        `What are the filter parameters and relations for the ${name} admin API endpoint in Medusa v2? Show me the endpoint path and available query parameters.`
      )

      if (mcpResponse) {
        contextParts.push(`### ${name} (Core)`)
        contextParts.push(`API Path: ${config.api_path}`)
        contextParts.push(mcpResponse.slice(0, 1200))
        contextParts.push("")
        continue
      }
    } catch (error) {
      console.log(`[HybridResolver] MCP client failed for ${name}, using static fallback`)
    }

    // Fall back to static MCP context
    const staticContext = await queryMedusaMCP(`${name} API`)
    if (staticContext) {
      contextParts.push(`### ${name} (Core)`)
      contextParts.push(`API Path: ${config.api_path}`)
      contextParts.push(staticContext.slice(0, 1200))
      contextParts.push("")
    }
  }

  return contextParts.join("\n")
}

/**
 * Build context for custom entities using registry info
 */
function getCustomEntityContext(
  customEntities: Array<{ name: string; config: CustomEntityConfig }>
): string {
  if (customEntities.length === 0) return ""

  const contextParts: string[] = [
    "## Custom Module Information",
    ""
  ]

  for (const { name, config } of customEntities) {
    contextParts.push(`### ${name} (Custom Module)`)
    contextParts.push(`- Module: ${config.module}`)
    contextParts.push(`- Model: ${config.model_name}`)
    contextParts.push(`- Description: ${config.description}`)
    contextParts.push(`- Relations: ${config.relations.join(", ") || "none"}`)
    contextParts.push(`- Service Methods: ${config.service_methods.join(", ")}`)
    if (config.resolvable_refs) {
      contextParts.push(`- Resolvable References:`)
      for (const [field, ref] of Object.entries(config.resolvable_refs)) {
        contextParts.push(`  - ${field} -> ${ref.entity} (search by: ${ref.search_by.join(", ")})`)
      }
    }
    contextParts.push("")
  }

  return contextParts.join("\n")
}

/**
 * Build LLM prompt specifically for core entity queries
 * Uses MCP documentation for accurate API context
 */
function buildCoreEntityPrompt(
  query: string,
  coreEntities: Array<{ name: string; config: CoreEntityConfig }>,
  mcpContext: string,
  projectRoot: string = process.cwd()
): string {
  const moduleList = getModuleListForPrompt(projectRoot)

  return `You are analyzing a Medusa 2.x codebase to resolve a user query about CORE Medusa entities.

USER QUERY: "${query}"

${moduleList}

DETECTED CORE ENTITIES: ${coreEntities.map(e => e.name).join(", ")}

${mcpContext}

Based on the Medusa API documentation above, generate an execution plan.

CORE ENTITY EXECUTION RULES:
1. Core entities use HTTP API endpoints (e.g., GET /admin/orders)
2. Use the "api" method type for HTTP calls
3. Filter parameters go in query string (e.g., ?customer_id=cus_123)
4. IMPORTANT - The "fields" parameter rules:
   - NEVER use fields=* (asterisk is NOT valid in Medusa v2)
   - To get default fields: omit the fields parameter entirely
   - To add relations to defaults: use +prefix (e.g., ?fields=+items,+customer)
   - To explicitly select fields: list them (e.g., ?fields=id,status,items)
5. For cross-entity queries (e.g., "orders for customer X"), use 2 steps:
   - Step 1: Find the referenced entity (e.g., customer by name)
   - Step 2: Query target entity with filter (e.g., orders?customer_id=$1.id)

FIELDS PARAMETER EXAMPLES:
- GET /admin/orders (returns default fields)
- GET /admin/orders?fields=+items,+customer (adds relations to defaults)
- GET /admin/orders?fields=id,status,total (explicit field list)
- WRONG: GET /admin/orders?fields=*,items (asterisk is invalid!)

SUPPORTED METHOD TYPES:
- "api": HTTP API calls (for core entities)
- "service": Service calls (for custom entities)
- "graph": query.graph() calls (for module links)
- "javascript": Post-processing (counts, formatting)

Respond in JSON format:
{
  "targetEntity": "order",
  "mode": "data",
  "patterns": ["show orders for customer X", "get orders with customer info"],
  "executionPlan": [
    {
      "step": 1,
      "action": "query",
      "method": "api",
      "code": "GET /admin/orders?fields=+items,+customer",
      "output": "orders with related data",
      "explanation": "Fetch orders using admin API with expanded relations using + prefix"
    }
  ],
  "confidence": 0.95
}`
}

/**
 * Build LLM prompt for mixed core + custom entity queries
 */
function buildMixedEntityPrompt(
  query: string,
  coreEntities: Array<{ name: string; config: CoreEntityConfig }>,
  customEntities: Array<{ name: string; config: CustomEntityConfig }>,
  mcpContext: string,
  codeSnippets: FileScore[],
  projectRoot: string = process.cwd()
): string {
  const moduleList = getModuleListForPrompt(projectRoot)
  const customContext = getCustomEntityContext(customEntities)

  const snippetsText = codeSnippets.length > 0
    ? codeSnippets
        .map((s, i) => `--- File ${i + 1}: ${s.file} (score: ${s.score.toFixed(2)}) ---\n${s.snippet}`)
        .join("\n\n")
    : "No code snippets found."

  return `You are analyzing a Medusa 2.x codebase to resolve a user query involving BOTH core and custom entities.

USER QUERY: "${query}"

${moduleList}

DETECTED ENTITIES:
- Core Medusa: ${coreEntities.map(e => e.name).join(", ") || "none"}
- Custom Modules: ${customEntities.map(e => e.name).join(", ") || "none"}

${mcpContext}

${customContext}

RELEVANT CODE SNIPPETS (for custom entities):
${snippetsText}

EXECUTION RULES:
1. Core entities (order, product, customer, etc.): Use "api" method with HTTP endpoints
2. Custom entities (design, partner, person, etc.): Use "service" method with module services
3. For module links between entities: Use "graph" method with query.graph()

IMPORTANT - Core API "fields" parameter rules:
- NEVER use fields=* (asterisk is NOT valid in Medusa v2)
- To get default fields: omit the fields parameter entirely
- To add relations to defaults: use +prefix (e.g., ?fields=+items,+customer)
- To explicitly select fields: list them (e.g., ?fields=id,status,items)

SERVICE METHOD SIGNATURE (for custom entities):
- FIRST arg (FILTERS): WHERE conditions (status, id, etc.) - use {} if none
- SECOND arg (CONFIG): order, take, skip, relations, select

EXAMPLES:
- Core (default fields): GET /admin/orders?customer_id=cus_123
- Core (with relations): GET /admin/orders?fields=+items,+customer
- WRONG: GET /admin/orders?fields=*,items (asterisk is invalid!)
- Custom: await designService.listDesigns({}, { relations: ['specifications'] })
- Graph: await query.graph({ entity: 'designs', fields: ['*', 'customer.*'] })

Respond in JSON format:
{
  "targetEntity": "primary_entity",
  "mode": "data",
  "patterns": ["natural language variations"],
  "executionPlan": [
    {
      "step": 1,
      "action": "query",
      "method": "api|service|graph",
      "code": "execution code",
      "output": "what this step produces",
      "explanation": "why this step"
    }
  ],
  "confidence": 0.95
}`
}

/**
 * Build LLM prompt for generic MCP-based resolution when no specific entities detected
 *
 * This handles queries about core Medusa concepts that aren't mapped to specific
 * entities (e.g., feature flags, settings, store configuration).
 */
function buildGenericMCPPrompt(
  query: string,
  mcpContext: string,
  projectRoot: string = process.cwd()
): string {
  const moduleList = getModuleListForPrompt(projectRoot)

  return `You are analyzing a Medusa 2.x codebase to resolve a user query.

USER QUERY: "${query}"

${moduleList}

MEDUSA DOCUMENTATION CONTEXT:
${mcpContext}

The user's query doesn't match any specific known entities, but the Medusa documentation above may help.

EXECUTION RULES:
1. If the documentation indicates an Admin API endpoint, use "api" method
2. If it requires a module service call, use "service" method
3. If you cannot determine an execution plan, return an empty executionPlan array

IMPORTANT - API "fields" parameter rules:
- NEVER use fields=* (asterisk is NOT valid in Medusa v2)
- To get default fields: omit the fields parameter entirely
- To add relations: use +prefix (e.g., ?fields=+items)

SUPPORTED METHOD TYPES:
- "api": HTTP API calls (e.g., GET /admin/stores)
- "service": Module service calls
- "javascript": Post-processing calculations

Respond in JSON format:
{
  "targetEntity": "entity_name_or_unknown",
  "mode": "data|analysis|chat",
  "patterns": ["query variations"],
  "executionPlan": [
    {
      "step": 1,
      "action": "query",
      "method": "api",
      "code": "GET /admin/endpoint",
      "output": "description of output",
      "explanation": "why this approach"
    }
  ],
  "confidence": 0.7
}

If you cannot determine how to execute this query from the documentation, respond with:
{
  "targetEntity": "unknown",
  "mode": "chat",
  "patterns": [],
  "executionPlan": [],
  "confidence": 0
}`
}

// ============================================================================
// Main Service Class
// ============================================================================

export class HybridQueryResolverService {
  private projectRoot: string
  private llmApiKey: string
  private llmModel: string
  private useIndexedFirst: boolean
  private maxSearchResults: number
  private indexedDocs: ReturnType<typeof loadPreIndexedDocs>
  // Contextual Retrieval enhancements
  private useContextualIndex: boolean
  private useReranker: boolean
  private contextualIndex: ContextualIndexService | null = null

  constructor(options: HybridResolverOptions = {}) {
    this.projectRoot = options.projectRoot || process.cwd()
    this.llmApiKey = options.llmApiKey || process.env.OPENROUTER_API_KEY || ""
    this.llmModel = options.llmModel || "anthropic/claude-sonnet-4"
    this.useIndexedFirst = options.useIndexedFirst ?? true
    this.maxSearchResults = options.maxSearchResults ?? 5
    // Contextual Retrieval: enabled by default for better accuracy
    this.useContextualIndex = options.useContextualIndex ?? true
    this.useReranker = options.useReranker ?? true

    // Load pre-indexed docs on initialization
    this.indexedDocs = loadPreIndexedDocs(this.projectRoot)

    // Initialize contextual index if enabled
    if (this.useContextualIndex) {
      this.contextualIndex = new ContextualIndexService(this.projectRoot)
      this.contextualIndex.load().then((loaded) => {
        if (loaded) {
          const stats = this.contextualIndex?.getStats()
          console.log(`[HybridResolver] Contextual index loaded: ${stats?.totalChunks} chunks from ${stats?.totalFiles} files`)
        } else {
          console.log(`[HybridResolver] Contextual index not available, using standard BM25`)
        }
      }).catch((err) => {
        console.warn(`[HybridResolver] Failed to load contextual index:`, err)
      })
    }
  }

  /**
   * Resolve a natural language query into an execution plan
   *
   * Routing logic:
   * 1. Detect entities from query using entity-registry
   * 2. For CORE entities (order, product, customer, etc.): Query Medusa MCP
   * 3. For CUSTOM entities (design, partner, etc.): Use BM25 code search
   * 4. For MIXED queries: Combine MCP + BM25 context
   *
   * @param query - The natural language query
   * @param clarification - Optional clarification context from user selection
   */
  async resolve(query: string, clarification?: ClarificationContext): Promise<ResolvedQuery> {
    let effectiveQuery = query

    // Step 0: Apply clarification context if provided (user already selected an option)
    if (clarification) {
      const applied = applyClarificationContext(query, clarification)
      effectiveQuery = applied.modifiedQuery
      console.log(`[HybridResolver] Applied clarification: ${clarification.selectedModule}`)
    } else {
      // Step 0.5: Check for ambiguity (human-in-the-loop)
      const ambiguity = detectAmbiguity(query)
      if (ambiguity.isAmbiguous && ambiguity.options) {
        console.log(`[HybridResolver] Ambiguous term detected: "${ambiguity.term}"`)
        return {
          query,
          targetEntity: "unknown",
          mode: "chat",
          patterns: [],
          executionPlan: [],
          confidence: 0,
          resolvedAt: new Date(),
          source: "fallback",
          // Human-in-the-loop response
          needsClarification: true,
          clarificationMessage: ambiguity.message,
          clarificationOptions: ambiguity.options,
        }
      }
    }

    // Step 1: Detect entities from the query using entity-registry
    const detectedEntityNames = detectEntities(effectiveQuery)
    const { coreEntities, customEntities } = classifyDetectedEntities(detectedEntityNames)

    console.log(`[HybridResolver] Detected entities:`)
    console.log(`  - Core: ${coreEntities.map(e => e.name).join(", ") || "none"}`)
    console.log(`  - Custom: ${customEntities.map(e => e.name).join(", ") || "none"}`)

    // Check if we have LLM API key for analysis
    if (!this.llmApiKey) {
      return {
        query,
        targetEntity: "unknown",
        mode: "chat",
        patterns: [],
        executionPlan: [],
        confidence: 0,
        resolvedAt: new Date(),
        source: "fallback",
      }
    }

    // Step 2: Route based on entity types
    // CASE A: Core entities only - Use Medusa MCP
    if (coreEntities.length > 0 && customEntities.length === 0) {
      console.log(`[HybridResolver] Routing to MCP for core entities`)
      return this.resolveWithMCP(effectiveQuery, coreEntities)
    }

    // CASE B: Custom entities only - Use BM25 + existing LLM
    if (customEntities.length > 0 && coreEntities.length === 0) {
      console.log(`[HybridResolver] Routing to BM25 for custom entities`)
      return this.resolveWithBM25(effectiveQuery, customEntities)
    }

    // CASE C: Mixed core + custom - Use both MCP and BM25
    if (coreEntities.length > 0 && customEntities.length > 0) {
      console.log(`[HybridResolver] Routing to mixed (MCP + BM25)`)
      return this.resolveWithMixed(effectiveQuery, coreEntities, customEntities)
    }

    // CASE D: No entities detected - Try MCP first, then fall back to BM25
    console.log(`[HybridResolver] No entities detected, trying MCP then generic search`)

    // Try pre-indexed docs first (fast path)
    if (this.useIndexedFirst) {
      const indexedResult = tryResolveFromIndex(
        effectiveQuery,
        this.indexedDocs.relations,
        this.indexedDocs.links
      )

      if (indexedResult) {
        return indexedResult
      }
    }

    // Try MCP for generic Medusa knowledge (e.g., feature flags, settings, configs)
    // This helps when the query is about core Medusa concepts but no specific entity was detected
    try {
      console.log(`[HybridResolver] Trying MCP for generic query`)
      const mcpResult = await this.resolveWithGenericMCP(effectiveQuery)
      if (mcpResult && mcpResult.confidence > 0.5 && mcpResult.executionPlan.length > 0) {
        console.log(`[HybridResolver] MCP returned result with confidence ${mcpResult.confidence}`)
        return mcpResult
      }
    } catch (error) {
      console.log(`[HybridResolver] MCP generic query failed, falling back to BM25:`, error)
    }

    // Fall back to BM25 + LLM (generic path)
    const searchResults = bm25Search(effectiveQuery, this.projectRoot, this.maxSearchResults)

    if (searchResults.length === 0) {
      return {
        query,
        targetEntity: "unknown",
        mode: "chat",
        patterns: [],
        executionPlan: [],
        confidence: 0,
        resolvedAt: new Date(),
        source: "fallback",
      }
    }

    const llmResult = await analyzeWithLLM(
      effectiveQuery,
      searchResults,
      this.llmApiKey,
      this.llmModel
    )

    return {
      ...llmResult,
      resolvedAt: new Date(),
      source: "bm25_llm",
    }
  }

  /**
   * Resolve query for core Medusa entities using MCP documentation
   */
  private async resolveWithMCP(
    query: string,
    coreEntities: Array<{ name: string; config: CoreEntityConfig }>
  ): Promise<ResolvedQuery> {
    try {
      // Get MCP context for core entities
      const mcpContext = await getCoreEntityMCPContext(coreEntities)

      if (!mcpContext) {
        console.log(`[HybridResolver] No MCP context available, falling back to BM25`)
        const searchResults = bm25Search(query, this.projectRoot, this.maxSearchResults)
        const llmResult = await analyzeWithLLM(query, searchResults, this.llmApiKey, this.llmModel)
        return { ...llmResult, resolvedAt: new Date(), source: "bm25_llm" }
      }

      // Build prompt with MCP context
      const prompt = buildCoreEntityPrompt(query, coreEntities, mcpContext, this.projectRoot)

      // Call LLM with core entity context
      const llmResponse = await callLLM(prompt, this.llmApiKey, this.llmModel)

      // Parse response
      let jsonStr = llmResponse.trim()
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
      }

      try {
        const parsed = JSON.parse(jsonStr)
        return {
          query,
          targetEntity: parsed.targetEntity || coreEntities[0]?.name || "unknown",
          mode: parsed.mode || "data",
          patterns: parsed.patterns || [],
          executionPlan: parsed.executionPlan || [],
          codeContext: mcpContext,
          confidence: parsed.confidence || 0.8,
          resolvedAt: new Date(),
          source: "bm25_llm", // Using same source for now, could add "mcp" source
        }
      } catch {
        console.log(`[HybridResolver] Failed to parse MCP LLM response`)
        return {
          query,
          targetEntity: coreEntities[0]?.name || "unknown",
          mode: "data",
          patterns: [],
          executionPlan: [],
          codeContext: mcpContext,
          confidence: 0,
          resolvedAt: new Date(),
          source: "fallback",
        }
      }
    } catch (error) {
      console.error(`[HybridResolver] MCP resolution failed:`, error)
      // Fall back to BM25
      const searchResults = bm25Search(query, this.projectRoot, this.maxSearchResults)
      const llmResult = await analyzeWithLLM(query, searchResults, this.llmApiKey, this.llmModel)
      return { ...llmResult, resolvedAt: new Date(), source: "bm25_llm" }
    }
  }

  /**
   * Resolve query for custom entities using BM25 search
   * Enhanced with Contextual Retrieval (Anthropic research) for 35-67% better accuracy
   */
  private async resolveWithBM25(
    query: string,
    customEntities: Array<{ name: string; config: CustomEntityConfig }>
  ): Promise<ResolvedQuery> {
    // Try pre-indexed docs first (fast path)
    if (this.useIndexedFirst) {
      const indexedResult = tryResolveFromIndex(
        query,
        this.indexedDocs.relations,
        this.indexedDocs.links
      )

      if (indexedResult) {
        return indexedResult
      }
    }

    // Use contextual index if available (35% improvement from contextual embeddings)
    let searchResults: FileScore[] = []
    let contextualResults: ContextualSearchResult[] = []

    if (this.useContextualIndex && this.contextualIndex?.isLoaded()) {
      console.log(`[HybridResolver] Using contextual retrieval for enhanced search`)

      // Get module filters from detected entities
      const moduleFilters = customEntities
        .map((e) => e.config.module?.replace(/s$/, ""))
        .filter(Boolean) as string[]

      // Search with contextual index (includes BM25 + context metadata + optional reranking)
      contextualResults = await this.contextualIndex.search(query, {
        topK: this.maxSearchResults * 2, // Get more for better coverage
        useReranker: this.useReranker,
        moduleFilter: moduleFilters.length > 0 ? moduleFilters : undefined,
      })

      // Convert to FileScore format for LLM prompt compatibility
      if (contextualResults.length > 0) {
        console.log(`[HybridResolver] Contextual search returned ${contextualResults.length} results`)

        searchResults = contextualResults.map((cr) => ({
          file: cr.file,
          score: cr.finalScore || cr.score,
          hits: [],
          // Include context in snippet for better LLM understanding
          snippet: cr.context
            ? `[Context: ${cr.context}]\n\n${cr.snippet}`
            : cr.snippet,
        }))
      }
    }

    // Fall back to standard BM25 if contextual index didn't yield results
    if (searchResults.length === 0) {
      console.log(`[HybridResolver] Falling back to standard BM25 search`)
      searchResults = bm25Search(query, this.projectRoot, this.maxSearchResults)

      // Apply reranking to standard BM25 results if enabled
      if (this.useReranker && searchResults.length > 0) {
        console.log(`[HybridResolver] Applying reranking to ${searchResults.length} BM25 results`)

        const rerankerInput: RerankSearchResult[] = searchResults.map((sr) => ({
          file: sr.file,
          score: sr.score,
          snippet: sr.snippet,
        }))

        try {
          const reranked = await rerankChunks(query, rerankerInput, {
            topK: this.maxSearchResults,
            minScore: 4,
          })

          // Convert back to FileScore format
          searchResults = reranked.map((r) => ({
            file: r.file,
            score: r.finalScore,
            hits: [],
            snippet: r.snippet,
          }))

          console.log(`[HybridResolver] Reranking returned ${searchResults.length} results`)
        } catch (error) {
          console.warn(`[HybridResolver] Reranking failed, using original order:`, error)
        }
      }
    }

    if (searchResults.length === 0) {
      // Still provide entity context even without code search results
      const customContext = getCustomEntityContext(customEntities)
      return {
        query,
        targetEntity: customEntities[0]?.name || "unknown",
        mode: "data",
        patterns: [],
        executionPlan: [],
        codeContext: customContext,
        confidence: 0.3,
        resolvedAt: new Date(),
        source: "fallback",
      }
    }

    // LLM analysis with code snippets (now includes contextual information)
    const llmResult = await analyzeWithLLM(
      query,
      searchResults,
      this.llmApiKey,
      this.llmModel
    )

    return {
      ...llmResult,
      resolvedAt: new Date(),
      source: this.useContextualIndex && contextualResults.length > 0
        ? "contextual_bm25_llm"
        : "bm25_llm",
    }
  }

  /**
   * Resolve query involving both core and custom entities
   */
  private async resolveWithMixed(
    query: string,
    coreEntities: Array<{ name: string; config: CoreEntityConfig }>,
    customEntities: Array<{ name: string; config: CustomEntityConfig }>
  ): Promise<ResolvedQuery> {
    try {
      // Get MCP context for core entities
      const mcpContext = await getCoreEntityMCPContext(coreEntities)

      // Get BM25 results for custom entities
      const searchResults = bm25Search(query, this.projectRoot, this.maxSearchResults)

      // Build mixed prompt
      const prompt = buildMixedEntityPrompt(
        query,
        coreEntities,
        customEntities,
        mcpContext,
        searchResults,
        this.projectRoot
      )

      // Call LLM with combined context
      const llmResponse = await callLLM(prompt, this.llmApiKey, this.llmModel)

      // Parse response
      let jsonStr = llmResponse.trim()
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
      }

      try {
        const parsed = JSON.parse(jsonStr)
        return {
          query,
          targetEntity: parsed.targetEntity || "unknown",
          mode: parsed.mode || "data",
          patterns: parsed.patterns || [],
          executionPlan: parsed.executionPlan || [],
          codeContext: [mcpContext, searchResults.map(s => s.snippet).join("\n\n")].filter(Boolean).join("\n\n"),
          confidence: parsed.confidence || 0.7,
          resolvedAt: new Date(),
          source: "bm25_llm",
        }
      } catch {
        console.log(`[HybridResolver] Failed to parse mixed LLM response`)
        return {
          query,
          targetEntity: "unknown",
          mode: "data",
          patterns: [],
          executionPlan: [],
          confidence: 0,
          resolvedAt: new Date(),
          source: "fallback",
        }
      }
    } catch (error) {
      console.error(`[HybridResolver] Mixed resolution failed:`, error)
      // Fall back to BM25 only
      const searchResults = bm25Search(query, this.projectRoot, this.maxSearchResults)
      const llmResult = await analyzeWithLLM(query, searchResults, this.llmApiKey, this.llmModel)
      return { ...llmResult, resolvedAt: new Date(), source: "bm25_llm" }
    }
  }

  /**
   * Resolve generic query using MCP documentation when no entities are detected
   *
   * This helps with queries about core Medusa concepts that aren't mapped to
   * specific entities in our registry (e.g., feature flags, settings, configs).
   */
  private async resolveWithGenericMCP(query: string): Promise<ResolvedQuery> {
    // Query the MCP for generic Medusa knowledge
    const mcpContext = await queryMedusaDocs(query)

    if (!mcpContext) {
      return {
        query,
        targetEntity: "unknown",
        mode: "chat",
        patterns: [],
        executionPlan: [],
        confidence: 0,
        resolvedAt: new Date(),
        source: "fallback",
      }
    }

    // Build a generic prompt for MCP-based resolution
    const prompt = buildGenericMCPPrompt(query, mcpContext, this.projectRoot)

    // Call LLM with MCP context
    const llmResponse = await callLLM(prompt, this.llmApiKey, this.llmModel)

    // Parse response
    let jsonStr = llmResponse.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
    }

    try {
      const parsed = JSON.parse(jsonStr)
      return {
        query,
        targetEntity: parsed.targetEntity || "unknown",
        mode: parsed.mode || "data",
        patterns: parsed.patterns || [],
        executionPlan: parsed.executionPlan || [],
        codeContext: mcpContext,
        confidence: parsed.confidence || 0.6,
        resolvedAt: new Date(),
        source: "mcp_generic",
      }
    } catch {
      console.log(`[HybridResolver] Failed to parse generic MCP LLM response`)
      return {
        query,
        targetEntity: "unknown",
        mode: "chat",
        patterns: [],
        executionPlan: [],
        codeContext: mcpContext,
        confidence: 0,
        resolvedAt: new Date(),
        source: "fallback",
      }
    }
  }

  /**
   * Get the search results without LLM analysis (for debugging)
   */
  search(query: string): FileScore[] {
    return bm25Search(query, this.projectRoot, this.maxSearchResults)
  }

  /**
   * Reload pre-indexed docs (call after regenerating docs)
   */
  reloadIndexedDocs(): void {
    this.indexedDocs = loadPreIndexedDocs(this.projectRoot)
  }

  /**
   * Check if pre-indexed docs are available
   */
  hasIndexedDocs(): { relations: boolean; links: boolean } {
    return {
      relations: this.indexedDocs.relations !== null,
      links: this.indexedDocs.links !== null,
    }
  }
}

// ============================================================================
// Singleton Instance (Performance Optimization)
// ============================================================================

/**
 * Cached singleton instance of HybridQueryResolverService
 * Prevents redundant index loading on every query (7.8MB contextual index)
 */
let cachedResolver: HybridQueryResolverService | null = null
let resolverInitialized: Promise<HybridQueryResolverService> | null = null

/**
 * Get or create a singleton instance of HybridQueryResolverService
 *
 * Benefits:
 * - Loads contextual index once (1,312 chunks from 880 files)
 * - Reuses the same instance across all queries
 * - Waits for index to load before returning
 *
 * Performance: First call ~500ms (loads index), subsequent calls <1ms
 */
export async function getHybridQueryResolver(
  options?: Partial<HybridResolverOptions>
): Promise<HybridQueryResolverService> {
  // If already initialized, return immediately
  if (cachedResolver) {
    return cachedResolver
  }

  // If initialization in progress, wait for it
  if (resolverInitialized) {
    return resolverInitialized
  }

  // Start initialization
  resolverInitialized = (async () => {
    console.log("[HybridResolver] Initializing singleton instance...")

    const resolver = new HybridQueryResolverService({
      llmApiKey: process.env.OPENROUTER_API_KEY || "",
      projectRoot: process.cwd(),
      useIndexedFirst: true,
      maxSearchResults: 5,
      // Contextual Retrieval (Anthropic research): 35-67% better accuracy
      useContextualIndex: true,
      useReranker: true,
      ...options,
    })

    // Wait for contextual index to load before returning
    if (resolver["contextualIndex"]) {
      const loaded = await resolver["contextualIndex"].load()
      if (loaded) {
        console.log("[HybridResolver] Singleton instance ready with contextual retrieval")
      } else {
        console.log("[HybridResolver] Singleton instance ready (contextual index unavailable)")
      }
    }

    cachedResolver = resolver
    return resolver
  })()

  return resolverInitialized
}

/**
 * Reset the singleton instance (useful for testing or hot reload)
 */
export function resetHybridQueryResolver(): void {
  cachedResolver = null
  resolverInitialized = null
}

// Export a singleton factory for use in Medusa container
export function createHybridQueryResolver(container: MedusaContainer): HybridQueryResolverService {
  // Try to get API key from config or env
  const apiKey = process.env.OPENROUTER_API_KEY || ""

  return new HybridQueryResolverService({
    llmApiKey: apiKey,
    projectRoot: process.cwd(),
  })
}

export default HybridQueryResolverService
