/**
 * BM25 Code Search using Ripgrep
 *
 * Alternative to pre-indexed documentation approach.
 * Dynamically searches codebase using ripgrep and ranks results using BM25 algorithm.
 *
 * BM25 Parameters:
 * - k1: Term frequency saturation (1.2-2.0, default 1.5)
 * - b: Length normalization (0-1, default 0.75)
 *
 * Usage:
 *   npx tsx src/scripts/bm25-code-search.ts "designs with specifications"
 */

import { spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

// BM25 parameters
const K1 = 1.5  // Term frequency saturation
const B = 0.75  // Length normalization

// Search configuration
const SEARCH_DIRS = [
  "src/modules",
  "src/api",
  "src/workflows",
  "src/links",
]

const FILE_PATTERNS = [
  "*.ts",
]

const EXCLUDE_PATTERNS = [
  "*.test.ts",
  "*.spec.ts",
  "__tests__",
  "node_modules",
  ".medusa",
]

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
  relevantLines: { line: number; content: string }[]
}

interface BM25Stats {
  totalDocs: number
  avgDocLength: number
  docLengths: Map<string, number>
  termDocFreq: Map<string, number>  // How many docs contain each term
}

/**
 * Extract search terms from natural language query
 */
function extractSearchTerms(query: string): string[] {
  // Remove common stop words
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "why", "how", "all", "each",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just", "and",
    "but", "if", "or", "because", "until", "while", "although",
    "show", "me", "get", "pull", "find", "list", "what", "which",
    "their", "them", "those", "this", "that", "these", "many", "much",
    "any", "last", "first", "running", "run"
  ])

  // Extract meaningful terms
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s_-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t))

  // Add compound terms for common patterns
  const compoundTerms: string[] = []

  // Look for entity_relation patterns
  for (let i = 0; i < terms.length - 1; i++) {
    // Patterns like "production_run" or "production runs"
    const compound = `${terms[i]}_${terms[i + 1]}`
    if (terms[i + 1] && !stopWords.has(terms[i + 1])) {
      compoundTerms.push(compound)
    }
  }

  // Add model-related search terms
  const modelTerms: string[] = []
  for (const term of terms) {
    // Add variations: design -> Design, designs, design_id
    const capitalized = term.charAt(0).toUpperCase() + term.slice(1)
    modelTerms.push(capitalized)
    if (!term.endsWith("s")) {
      modelTerms.push(term + "s")
    }
    modelTerms.push(term + "_id")
  }

  // Also add relation-specific patterns
  const relationPatterns = [
    "hasMany",
    "hasOne",
    "belongsTo",
    "model.define",
    "defineLink",
  ]

  return [...new Set([...terms, ...compoundTerms, ...modelTerms])]
}

/**
 * Run grep search for a term (using grep -r since ripgrep may not be available)
 */
function grepSearch(term: string, dirs: string[]): SearchHit[] {
  const hits: SearchHit[] = []

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue

    // Use grep with recursive search, case insensitive, line numbers
    // --include for file patterns
    const args = [
      "-r",
      "-n",
      "-i",
      "--include=*.ts",
      term,
      dir
    ]

    if (process.env.DEBUG) {
      console.log(`[DEBUG] Running: grep ${args.join(" ")}`)
    }

    const result = spawnSync("grep", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,  // 10MB buffer
    })

    // Debug: show result status
    if (process.env.DEBUG) {
      console.log(`[DEBUG] Exit code: ${result.status}, stdout length: ${result.stdout?.length || 0}`)
    }

    // spawnSync returns stdout even when exit code is non-zero (grep returns 1 for no match)
    const output = result.stdout || ""

    for (const line of output.split("\n")) {
      if (!line.trim()) continue

      // Skip test files
      if (line.includes(".test.ts") || line.includes(".spec.ts") || line.includes("__tests__")) {
        continue
      }

      // Parse grep output: file:line:content
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

    // Log errors in debug mode
    if (process.env.DEBUG && result.stderr) {
      console.log(`[DEBUG] Stderr: ${result.stderr}`)
    }
  }

  return hits
}

/**
 * Get total lines in a file (as document length)
 */
function getFileLength(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return content.split("\n").length
  } catch {
    return 0
  }
}

/**
 * Build BM25 statistics from search results
 */
function buildBM25Stats(hits: SearchHit[]): BM25Stats {
  const files = new Set(hits.map(h => h.file))
  const docLengths = new Map<string, number>()
  const termDocFreq = new Map<string, number>()

  // Get document lengths
  let totalLength = 0
  for (const file of files) {
    const length = getFileLength(file)
    docLengths.set(file, length)
    totalLength += length
  }

  // Calculate term document frequency
  const fileTerms = new Map<string, Set<string>>()
  for (const hit of hits) {
    if (!fileTerms.has(hit.file)) {
      fileTerms.set(hit.file, new Set())
    }
    fileTerms.get(hit.file)!.add(hit.term)
  }

  for (const [, terms] of fileTerms) {
    for (const term of terms) {
      termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1)
    }
  }

  return {
    totalDocs: files.size,
    avgDocLength: files.size > 0 ? totalLength / files.size : 1,
    docLengths,
    termDocFreq,
  }
}

/**
 * Calculate BM25 score for a document
 */
function calculateBM25Score(
  file: string,
  fileHits: SearchHit[],
  stats: BM25Stats,
  terms: string[]
): number {
  const docLength = stats.docLengths.get(file) || 1
  const avgDocLength = stats.avgDocLength
  const totalDocs = stats.totalDocs

  let score = 0

  // Count term frequencies in this document
  const termFreq = new Map<string, number>()
  for (const hit of fileHits) {
    termFreq.set(hit.term, (termFreq.get(hit.term) || 0) + 1)
  }

  for (const term of terms) {
    const tf = termFreq.get(term) || 0
    if (tf === 0) continue

    const df = stats.termDocFreq.get(term) || 1

    // IDF component: log((N - df + 0.5) / (df + 0.5))
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)

    // TF component with saturation: (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength / avgDocLength))
    const tfComponent = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * docLength / avgDocLength))

    score += idf * tfComponent
  }

  // Bonus for files that match multiple terms
  const uniqueTerms = new Set(fileHits.map(h => h.term))
  score *= (1 + 0.2 * (uniqueTerms.size - 1))

  // Bonus for model/service/link files (more relevant to our use case)
  if (file.includes("/models/")) score *= 1.5
  if (file.includes("/service")) score *= 1.3
  if (file.includes("/links/")) score *= 1.4
  if (file.includes("route.ts")) score *= 1.2

  return score
}

/**
 * Extract relevant code snippet around hits
 */
function extractSnippet(file: string, hits: SearchHit[], contextLines: number = 5): string {
  try {
    const content = fs.readFileSync(file, "utf-8")
    const lines = content.split("\n")

    // Find all relevant line ranges
    const hitLines = new Set(hits.map(h => h.line))
    const relevantLines = new Set<number>()

    for (const hitLine of hitLines) {
      for (let i = Math.max(1, hitLine - contextLines); i <= Math.min(lines.length, hitLine + contextLines); i++) {
        relevantLines.add(i)
      }
    }

    // Build snippet with line numbers
    const sortedLines = [...relevantLines].sort((a, b) => a - b)
    const snippetLines: string[] = []
    let lastLine = 0

    for (const lineNum of sortedLines) {
      if (lastLine > 0 && lineNum > lastLine + 1) {
        snippetLines.push("    ...")
      }
      const prefix = hitLines.has(lineNum) ? ">>> " : "    "
      snippetLines.push(`${prefix}${lineNum}: ${lines[lineNum - 1]}`)
      lastLine = lineNum
    }

    return snippetLines.join("\n")
  } catch {
    return hits.map(h => `${h.line}: ${h.content}`).join("\n")
  }
}

/**
 * Search code using BM25 ranking
 */
function bm25Search(query: string, topK: number = 10): FileScore[] {
  console.log("\n" + "=".repeat(60))
  console.log("  BM25 Code Search")
  console.log("=".repeat(60))
  console.log(`Query: "${query}"`)

  // 1. Extract search terms
  const terms = extractSearchTerms(query)
  console.log(`\nExtracted terms: ${terms.join(", ")}`)

  // 2. Run grep searches
  console.log("\nSearching codebase...")
  const allHits: SearchHit[] = []

  for (const term of terms) {
    const hits = grepSearch(term, SEARCH_DIRS)
    allHits.push(...hits)
    if (hits.length > 0) {
      console.log(`  "${term}": ${hits.length} hits`)
    }
  }

  if (allHits.length === 0) {
    console.log("\nNo results found.")
    return []
  }

  // 3. Group hits by file
  const fileHits = new Map<string, SearchHit[]>()
  for (const hit of allHits) {
    if (!fileHits.has(hit.file)) {
      fileHits.set(hit.file, [])
    }
    fileHits.get(hit.file)!.push(hit)
  }

  console.log(`\nFound matches in ${fileHits.size} files`)

  // 4. Build BM25 statistics
  const stats = buildBM25Stats(allHits)

  // 5. Calculate BM25 scores
  const fileScores: FileScore[] = []

  for (const [file, hits] of fileHits) {
    const score = calculateBM25Score(file, hits, stats, terms)
    const snippet = extractSnippet(file, hits)

    fileScores.push({
      file,
      score,
      hits,
      snippet,
      relevantLines: hits.map(h => ({ line: h.line, content: h.content }))
    })
  }

  // 6. Sort by score and return top K
  fileScores.sort((a, b) => b.score - a.score)

  return fileScores.slice(0, topK)
}

/**
 * Analyze search results to extract useful context for AI
 */
function analyzeResults(results: FileScore[]): {
  entities: string[]
  relations: { name: string; type: string; target: string }[]
  apiEndpoints: string[]
  servicePatterns: string[]
} {
  const entities: Set<string> = new Set()
  const relations: { name: string; type: string; target: string }[] = []
  const apiEndpoints: Set<string> = new Set()
  const servicePatterns: Set<string> = new Set()

  for (const result of results) {
    const content = result.snippet

    // Extract entity names from model.define()
    const modelMatch = content.match(/model\.define\s*\(\s*["'](\w+)["']/g)
    if (modelMatch) {
      for (const m of modelMatch) {
        const name = m.match(/["'](\w+)["']/)?.[1]
        if (name) entities.add(name)
      }
    }

    // Extract relations (hasMany, hasOne, belongsTo)
    const relationPatterns = [
      /(\w+):\s*model\.hasMany\s*\(\s*\(\)\s*=>\s*(?:require\([^)]+\)\.)?(\w+)/g,
      /(\w+):\s*model\.hasOne\s*\(\s*\(\)\s*=>\s*(?:require\([^)]+\)\.)?(\w+)/g,
      /(\w+):\s*model\.belongsTo\s*\(\s*\(\)\s*=>\s*(?:require\([^)]+\)\.)?(\w+)/g,
    ]

    for (const pattern of relationPatterns) {
      const matches = content.matchAll(pattern)
      for (const match of matches) {
        relations.push({
          name: match[1],
          type: pattern.source.includes("hasMany") ? "hasMany" :
                pattern.source.includes("hasOne") ? "hasOne" : "belongsTo",
          target: match[2]
        })
      }
    }

    // Extract API endpoints
    if (result.file.includes("/api/")) {
      const pathParts = result.file.split("/api/")[1]?.replace("/route.ts", "")
      if (pathParts) {
        apiEndpoints.add(`/api/${pathParts}`)
      }
    }

    // Extract service patterns
    const serviceMatch = content.match(/await\s+(\w+Service|\w+)\.(\w+)\s*\(/g)
    if (serviceMatch) {
      for (const m of serviceMatch) {
        servicePatterns.add(m.replace(/\s*\($/, ""))
      }
    }
  }

  return {
    entities: [...entities],
    relations: relations.filter((r, i, arr) =>
      arr.findIndex(x => x.name === r.name && x.type === r.type) === i
    ),
    apiEndpoints: [...apiEndpoints],
    servicePatterns: [...servicePatterns]
  }
}

/**
 * Generate execution plan suggestion from search results
 */
function suggestPlan(query: string, results: FileScore[], analysis: ReturnType<typeof analyzeResults>): string {
  const lines: string[] = [
    "\n" + "=".repeat(60),
    "  Suggested Execution Plan",
    "=".repeat(60),
  ]

  if (results.length === 0) {
    lines.push("\nNo relevant code found for this query.")
    return lines.join("\n")
  }

  // Determine query type
  const isRelationQuery = query.match(/with|including|their|have/i)
  const isCountQuery = query.match(/how many|count|total/i)

  lines.push(`\nQuery type: ${isCountQuery ? "COUNT" : isRelationQuery ? "RELATION" : "LIST"}`)

  // Show detected entities and relations
  if (analysis.entities.length > 0) {
    lines.push(`\nDetected entities: ${analysis.entities.join(", ")}`)
  }

  if (analysis.relations.length > 0) {
    lines.push(`\nDetected relations:`)
    for (const rel of analysis.relations) {
      lines.push(`  - ${rel.name} (${rel.type}) → ${rel.target}`)
    }
  }

  // Suggest query approach
  lines.push(`\nSuggested approach:`)

  if (analysis.relations.length > 0 && isRelationQuery) {
    const primaryEntity = analysis.entities[0] || "unknown"
    const relationNames = analysis.relations.map(r => r.name)

    lines.push(`  1. Use service.list() with relations parameter:`)
    lines.push(`     await ${primaryEntity}Service.list({`)
    lines.push(`       relations: ${JSON.stringify(relationNames)}`)
    lines.push(`     })`)
  } else if (analysis.apiEndpoints.length > 0) {
    lines.push(`  1. Call API endpoint:`)
    lines.push(`     GET ${analysis.apiEndpoints[0]}`)
  }

  // Show top file matches
  lines.push(`\nTop matching files:`)
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i]
    lines.push(`  ${i + 1}. ${r.file} (score: ${r.score.toFixed(2)})`)
  }

  return lines.join("\n")
}

// Main execution
async function main() {
  const query = process.argv[2]

  if (!query) {
    console.log("Usage: npx tsx src/scripts/bm25-code-search.ts \"<query>\"")
    console.log("\nExamples:")
    console.log('  npx tsx src/scripts/bm25-code-search.ts "designs with specifications"')
    console.log('  npx tsx src/scripts/bm25-code-search.ts "how many partners have feedback"')
    console.log('  npx tsx src/scripts/bm25-code-search.ts "production runs for design"')
    process.exit(1)
  }

  // Run BM25 search
  const results = bm25Search(query, 10)

  // Display results
  console.log("\n" + "=".repeat(60))
  console.log("  Top Results (BM25 Ranked)")
  console.log("=".repeat(60))

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    console.log(`\n--- ${i + 1}. ${r.file} ---`)
    console.log(`Score: ${r.score.toFixed(4)}`)
    console.log(`Matched terms: ${[...new Set(r.hits.map(h => h.term))].join(", ")}`)
    console.log(`\n${r.snippet}`)
  }

  // Analyze and suggest plan
  const analysis = analyzeResults(results)
  const plan = suggestPlan(query, results, analysis)
  console.log(plan)
}

main().catch(console.error)
