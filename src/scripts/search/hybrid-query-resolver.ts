/**
 * Hybrid Query Resolver
 *
 * Combines BM25 code search with LLM analysis to generate:
 * 1. Natural language query patterns
 * 2. Execution steps with actual code
 * 3. Resolution paths for complex queries
 *
 * Usage:
 *   npx tsx src/scripts/hybrid-query-resolver.ts "designs with specifications"
 */

import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { config } from "dotenv"

// Load .env file
config()

// BM25 parameters
const K1 = 1.5
const B = 0.75

// Search directories
const SEARCH_DIRS = ["src/modules", "src/api", "src/workflows", "src/links"]

// OpenRouter config
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const MODEL = "anthropic/claude-sonnet-4"

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

interface ExecutionStep {
  step: number
  action: "query" | "extract" | "filter" | "transform"
  method: "service" | "graph" | "api"
  code: string
  output: string
  explanation: string
}

interface ResolvedQuery {
  query: string
  targetEntity: string
  mode: "data" | "analysis" | "create" | "update"
  patterns: string[]
  executionPlan: ExecutionStep[]
  codeContext: string
  confidence: number
}

// ============================================================================
// BM25 Search (from bm25-code-search.ts)
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

  // Add variations
  const variations: string[] = []
  for (const term of terms) {
    variations.push(term)
    variations.push(term.charAt(0).toUpperCase() + term.slice(1))
    if (!term.endsWith("s")) variations.push(term + "s")
    variations.push(term + "_id")
  }

  // Add compound terms
  for (let i = 0; i < terms.length - 1; i++) {
    variations.push(`${terms[i]}_${terms[i + 1]}`)
  }

  return [...new Set(variations)]
}

function grepSearch(term: string, dirs: string[]): SearchHit[] {
  const hits: SearchHit[] = []

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue

    const result = spawnSync("grep", ["-r", "-n", "-i", "--include=*.ts", term, dir], {
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
          file: match[1],
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

function extractSnippet(file: string, hits: SearchHit[], contextLines: number = 3): string {
  try {
    const content = fs.readFileSync(file, "utf-8")
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

    return snippetLines.slice(0, 30).join("\n") // Limit snippet size
  } catch {
    return hits.map(h => `${h.line}: ${h.content}`).join("\n")
  }
}

function bm25Search(query: string, topK: number = 5): FileScore[] {
  const terms = extractSearchTerms(query)
  const allHits: SearchHit[] = []

  for (const term of terms) {
    allHits.push(...grepSearch(term, SEARCH_DIRS))
  }

  if (allHits.length === 0) return []

  // Group by file
  const fileHits = new Map<string, SearchHit[]>()
  for (const hit of allHits) {
    if (!fileHits.has(hit.file)) fileHits.set(hit.file, [])
    fileHits.get(hit.file)!.push(hit)
  }

  // Build stats
  const files = [...fileHits.keys()]
  const docLengths = new Map<string, number>()
  let totalLength = 0
  for (const file of files) {
    const length = getFileLength(file)
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

  // Score files
  const fileScores: FileScore[] = []
  for (const [file, hits] of fileHits) {
    const score = calculateBM25Score(file, hits, stats, terms)
    fileScores.push({
      file,
      score,
      hits,
      snippet: extractSnippet(file, hits),
    })
  }

  fileScores.sort((a, b) => b.score - a.score)
  return fileScores.slice(0, topK)
}

// ============================================================================
// LLM Analysis
// ============================================================================

async function callLLM(prompt: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not set. Please set OPENROUTER_API_KEY environment variable.")
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
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

async function analyzeWithLLM(query: string, codeSnippets: FileScore[]): Promise<ResolvedQuery> {
  const snippetsText = codeSnippets
    .map((s, i) => `--- File ${i + 1}: ${s.file} (score: ${s.score.toFixed(2)}) ---\n${s.snippet}`)
    .join("\n\n")

  const prompt = `You are analyzing a Medusa 2.x codebase to understand how to resolve a user query.

USER QUERY: "${query}"

RELEVANT CODE SNIPPETS FROM BM25 SEARCH:
${snippetsText}

Based on these code snippets, analyze the query and generate:

1. **Target Entity**: What entity is the user asking about?
2. **Mode**: Is this data retrieval, analysis (count/stats), create, or update?
3. **Query Patterns**: 5-8 natural language variations of how users might ask this
4. **Execution Plan**: Step-by-step code to resolve this query

IMPORTANT RULES FOR EXECUTION PLAN:
- For model relations (hasMany/hasOne/belongsTo within a module): Use service.list() with { relations: [...] }
- For module links (defineLink across modules in src/links/): Use query.graph()
- Service method naming: listDesigns, retrieveDesign, listAndCountDesigns (PascalCase entity name)
- Always use actual method names from the code snippets

Respond in JSON format:
{
  "targetEntity": "design",
  "mode": "data",
  "patterns": [
    "show me designs with their specifications",
    "get all designs including specifications",
    ...
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

  const llmResponse = await callLLM(prompt)

  // Parse JSON from response
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
      codeContext: snippetsText,
      confidence: parsed.confidence || 0.5,
    }
  } catch (error) {
    console.error("Failed to parse LLM response:", error)
    return {
      query,
      targetEntity: "unknown",
      mode: "data",
      patterns: [],
      executionPlan: [],
      codeContext: snippetsText,
      confidence: 0,
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function resolveQuery(query: string): Promise<ResolvedQuery> {
  console.log("=" .repeat(70))
  console.log("  Hybrid Query Resolver (BM25 + LLM)")
  console.log("=".repeat(70))
  console.log(`\nQuery: "${query}"`)

  // Step 1: BM25 Search
  console.log("\n[Step 1] BM25 Code Search...")
  const searchResults = bm25Search(query, 5)

  if (searchResults.length === 0) {
    console.log("  No relevant code found.")
    return {
      query,
      targetEntity: "unknown",
      mode: "data",
      patterns: [],
      executionPlan: [],
      codeContext: "",
      confidence: 0,
    }
  }

  console.log(`  Found ${searchResults.length} relevant files:`)
  for (const r of searchResults) {
    console.log(`    - ${r.file} (score: ${r.score.toFixed(2)})`)
  }

  // Step 2: LLM Analysis
  console.log("\n[Step 2] LLM Analysis...")
  const resolved = await analyzeWithLLM(query, searchResults)

  // Step 3: Display Results
  console.log("\n" + "=".repeat(70))
  console.log("  Resolution Result")
  console.log("=".repeat(70))

  console.log(`\nTarget Entity: ${resolved.targetEntity}`)
  console.log(`Mode: ${resolved.mode}`)
  console.log(`Confidence: ${(resolved.confidence * 100).toFixed(0)}%`)

  console.log("\n--- Natural Language Patterns ---")
  for (const pattern of resolved.patterns) {
    console.log(`  • ${pattern}`)
  }

  console.log("\n--- Execution Plan ---")
  for (const step of resolved.executionPlan) {
    console.log(`\n  [Step ${step.step}] ${step.action} via ${step.method}`)
    console.log(`  ${step.explanation}`)
    console.log("  ```typescript")
    console.log(`  ${step.code}`)
    console.log("  ```")
    console.log(`  → Output: ${step.output}`)
  }

  return resolved
}

async function main() {
  const queries = process.argv.slice(2)

  if (queries.length === 0) {
    // Default test queries
    const testQueries = [
      "designs with specifications",
      "partners with feedback",
      "visual flows with executions",
      "production runs for design SKU123",
    ]

    console.log("Running test queries...\n")

    for (const query of testQueries) {
      try {
        await resolveQuery(query)
        console.log("\n" + "─".repeat(70) + "\n")
      } catch (error) {
        console.error(`Error resolving "${query}":`, error)
      }
    }
  } else {
    // Single query from command line
    await resolveQuery(queries.join(" "))
  }
}

main().catch(console.error)
