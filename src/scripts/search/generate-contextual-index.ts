/**
 * Contextual Index Generator
 *
 * Based on Anthropic's Contextual Retrieval research:
 * https://www.anthropic.com/engineering/contextual-retrieval
 *
 * This script generates contextual summaries for code files to improve
 * RAG retrieval accuracy by 35-67%.
 *
 * Usage:
 *   npx tsx src/scripts/generate-contextual-index.ts
 *   npx tsx src/scripts/generate-contextual-index.ts --dry-run
 *   npx tsx src/scripts/generate-contextual-index.ts --file src/api/admin/designs/route.ts
 */

import * as fs from "fs"
import * as path from "path"
import { sync as globSync } from "glob"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Files to process
  patterns: [
    "src/api/**/*.ts",
    "src/modules/**/service.ts",
    "src/modules/**/models/*.ts",
    "src/workflows/**/*.ts",
    "src/links/*.ts",
  ],
  excludePatterns: [
    "**/__tests__/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
  ],

  // Output directory for context files
  outputDir: ".contextual-index",

  // LLM settings via OpenRouter (fast, free models)
  model: "mistralai/devstral-2512:free",
  fallbackModels: [
    "mistralai/devstral-2512:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  maxTokens: 200,

  // Chunk settings
  maxChunkSize: 4000, // characters
  contextTokenTarget: 100, // target context length in tokens

  // Rate limiting and batching
  batchSize: 5, // Process N files before cooling off
  delayBetweenCalls: 500, // ms between individual calls
  batchCooldownMs: 5000, // 5 second cooldown between batches
  rateLimitCooldownMs: 30000, // 30 second cooldown after rate limit
  maxRetries: 3, // Max retries per chunk
}

// ============================================================================
// Types
// ============================================================================

interface ContextualChunk {
  filePath: string
  chunkIndex: number
  originalContent: string
  context: string
  contextualContent: string
  metadata: {
    module: string | null
    entityType: string | null
    operation: string | null
    apiPath: string | null
    relatedEntities: string[]
  }
  generatedAt: Date
}

interface IndexFile {
  version: string
  generatedAt: Date
  totalFiles: number
  totalChunks: number
  chunks: ContextualChunk[]
}

// ============================================================================
// Context Generation
// ============================================================================

const CONTEXT_PROMPT = `<document>
{file_content}
</document>

<chunk>
{chunk_content}
</chunk>

You are analyzing a Medusa 2.x e-commerce codebase for a textile/fashion business.
This codebase has custom modules for: designs, partners, production runs, inventory orders, persons, feedbacks, tasks, agreements, and more.

Provide a SHORT context (50-100 tokens) to situate this code chunk within the document. Include:

1. **Module**: Which module (design, partner, order, product, customer, production_run, inventory_order, person, task, feedback, agreement, form, website, media, etc.)
2. **Type**: What kind of code (API endpoint, service method, model definition, workflow step, link definition, subscriber)
3. **Operation**: What it does (list, retrieve, create, update, delete, count, search, link, unlink)
4. **Entities**: Related entities and their relationships
5. **API Path**: If an endpoint, include the HTTP method and path

Format your response as a single paragraph starting with bracketed metadata, like:
"[Module: design | Type: POST endpoint | Op: create] Creates a new design record with specifications and colors. Validates request body, calls designService.createDesigns(), and returns the created design. Related entities: DesignSpecifications, DesignColors, Partner (via link)."

Rules:
- Be CONCISE - aim for 50-100 tokens
- Focus on WHAT this code does and HOW it relates to other entities
- Include specific method names, field names, or status values if relevant
- Do NOT include implementation details unless critical for understanding

Respond ONLY with the context paragraph, nothing else.`

// OpenRouter client type
type OpenRouterClient = ReturnType<typeof createOpenRouter>

// Rate limit state tracking
let lastRateLimitTime = 0
let consecutiveRateLimits = 0

// Helper for sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Check if we should wait due to recent rate limits
async function waitIfRateLimited(): Promise<void> {
  const timeSinceRateLimit = Date.now() - lastRateLimitTime
  if (timeSinceRateLimit < CONFIG.rateLimitCooldownMs && consecutiveRateLimits > 0) {
    const waitTime = CONFIG.rateLimitCooldownMs - timeSinceRateLimit
    console.log(`⏳ Cooling off for ${Math.ceil(waitTime / 1000)}s due to rate limits...`)
    await sleep(waitTime)
  }
}

async function generateContext(
  openrouter: OpenRouterClient,
  fileContent: string,
  chunkContent: string
): Promise<string> {
  const prompt = CONTEXT_PROMPT
    .replace("{file_content}", fileContent.slice(0, 8000)) // Limit document context
    .replace("{chunk_content}", chunkContent)

  const models = [CONFIG.model, ...CONFIG.fallbackModels]

  // Wait if we've been rate limited recently
  await waitIfRateLimited()

  for (const modelId of models) {
    let retries = 0

    while (retries < CONFIG.maxRetries) {
      try {
        const { text } = await generateText({
          model: openrouter(modelId) as any,
          prompt,
          maxTokens: CONFIG.maxTokens,
          temperature: 0.2,
        })

        // Success - reset rate limit tracking
        consecutiveRateLimits = 0
        return text?.trim() || ""
      } catch (error: any) {
        const isRateLimit = error?.statusCode === 429 ||
                           error?.message?.includes("429") ||
                           error?.message?.includes("rate limit") ||
                           error?.message?.includes("Rate limit")

        if (isRateLimit) {
          lastRateLimitTime = Date.now()
          consecutiveRateLimits++

          // Exponential backoff: 5s, 15s, 45s
          const backoffTime = Math.min(5000 * Math.pow(3, retries), 60000)
          console.warn(`⚠️ Rate limited on ${modelId}. Waiting ${backoffTime / 1000}s (retry ${retries + 1}/${CONFIG.maxRetries})...`)
          await sleep(backoffTime)
          retries++
        } else {
          // Non-rate-limit error - try next model
          console.warn(`Model ${modelId} failed: ${error?.message?.slice(0, 100)}`)
          break
        }
      }
    }
  }

  console.error("All models failed for context generation")
  return ""
}

// ============================================================================
// Metadata Extraction
// ============================================================================

function extractMetadata(filePath: string, content: string, context: string) {
  const metadata = {
    module: null as string | null,
    entityType: null as string | null,
    operation: null as string | null,
    apiPath: null as string | null,
    relatedEntities: [] as string[],
  }

  // Extract module from path
  const moduleMatch = filePath.match(/src\/(?:api\/admin|modules)\/([^/]+)/)
  if (moduleMatch) {
    metadata.module = moduleMatch[1].replace(/-/g, "_")
  }

  // Extract API path
  const pathMatch = filePath.match(/src\/api\/(.+?)\/route\.ts/)
  if (pathMatch) {
    metadata.apiPath = "/" + pathMatch[1].replace(/\[([^\]]+)\]/g, ":$1")
  }

  // Detect entity type from content
  if (content.includes("export const GET")) metadata.operation = "list/retrieve"
  if (content.includes("export const POST")) metadata.operation = "create"
  if (content.includes("export const PUT") || content.includes("export const PATCH"))
    metadata.operation = "update"
  if (content.includes("export const DELETE")) metadata.operation = "delete"

  // Detect file type
  if (filePath.includes("/route.ts")) metadata.entityType = "endpoint"
  else if (filePath.includes("/service.ts")) metadata.entityType = "service"
  else if (filePath.includes("/models/")) metadata.entityType = "model"
  else if (filePath.includes("/workflows/")) metadata.entityType = "workflow"
  else if (filePath.includes("/links/")) metadata.entityType = "link"
  else if (filePath.includes("/subscribers/")) metadata.entityType = "subscriber"

  // Extract related entities from context
  const entityPattern =
    /(?:Related|Entities|Links?):?\s*([A-Z][a-zA-Z]+(?:,?\s*[A-Z][a-zA-Z]+)*)/i
  const entityMatch = context.match(entityPattern)
  if (entityMatch) {
    metadata.relatedEntities = entityMatch[1]
      .split(/[,\s]+/)
      .filter((e) => e.length > 2)
      .map((e) => e.trim())
  }

  return metadata
}

// ============================================================================
// File Processing
// ============================================================================

function chunkFile(content: string, maxSize: number = CONFIG.maxChunkSize): string[] {
  // For small files, return as single chunk
  if (content.length <= maxSize) {
    return [content]
  }

  // Split by logical boundaries (functions, classes, exports)
  const chunks: string[] = []
  const lines = content.split("\n")
  let currentChunk = ""

  for (const line of lines) {
    // Check if this line starts a new logical block
    const isBlockStart =
      /^(export\s+|async\s+function|function\s+|class\s+|const\s+\w+\s*=\s*(?:async\s*)?\(|describe\()/.test(
        line.trim()
      )

    if (isBlockStart && currentChunk.length > maxSize / 2) {
      chunks.push(currentChunk.trim())
      currentChunk = ""
    }

    currentChunk += line + "\n"

    // Force split if chunk gets too large
    if (currentChunk.length > maxSize) {
      chunks.push(currentChunk.trim())
      currentChunk = ""
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.filter((c) => c.length > 50) // Filter out tiny chunks
}

async function processFile(
  openrouter: OpenRouterClient,
  filePath: string,
  dryRun: boolean = false
): Promise<ContextualChunk[]> {
  const absolutePath = path.resolve(filePath)
  const content = fs.readFileSync(absolutePath, "utf-8")

  // Skip empty or very small files
  if (content.length < 100) {
    return []
  }

  const chunks = chunkFile(content)
  const results: ContextualChunk[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    if (dryRun) {
      console.log(`  [DRY RUN] Would process chunk ${i + 1}/${chunks.length}`)
      results.push({
        filePath,
        chunkIndex: i,
        originalContent: chunk,
        context: "[DRY RUN - no context generated]",
        contextualContent: chunk,
        metadata: extractMetadata(filePath, chunk, ""),
        generatedAt: new Date(),
      })
      continue
    }

    // Generate context
    const context = await generateContext(openrouter, content, chunk)

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenCalls))

    const metadata = extractMetadata(filePath, chunk, context)

    results.push({
      filePath,
      chunkIndex: i,
      originalContent: chunk,
      context,
      contextualContent: context ? `${context}\n\n${chunk}` : chunk,
      metadata,
      generatedAt: new Date(),
    })

    console.log(`  ✓ Chunk ${i + 1}/${chunks.length}: ${context.slice(0, 80)}...`)
  }

  return results
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const singleFile = args.find((a) => a.startsWith("--file="))?.split("=")[1]

  console.log("=" .repeat(60))
  console.log("  Contextual Index Generator")
  console.log("  Based on Anthropic's Contextual Retrieval")
  console.log("=" .repeat(60))
  console.log()

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No API calls will be made\n")
  }

  // Initialize OpenRouter client
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey && !dryRun) {
    console.error("❌ OPENROUTER_API_KEY environment variable is required")
    process.exit(1)
  }

  const openrouter = createOpenRouter({ apiKey: apiKey || "dry-run" })

  // Find files to process
  let files: string[] = []

  if (singleFile) {
    files = [singleFile]
  } else {
    for (const pattern of CONFIG.patterns) {
      const matches = globSync(pattern, { ignore: CONFIG.excludePatterns })
      files.push(...matches)
    }
  }

  // Remove duplicates and sort
  files = [...new Set(files)].sort()

  console.log(`📁 Found ${files.length} files to process`)
  console.log(`📦 Processing in batches of ${CONFIG.batchSize} files with ${CONFIG.batchCooldownMs / 1000}s cooldown\n`)

  // Process files in batches
  const allChunks: ContextualChunk[] = []
  let processedCount = 0
  let batchCount = 0
  const totalBatches = Math.ceil(files.length / CONFIG.batchSize)

  for (let i = 0; i < files.length; i += CONFIG.batchSize) {
    const batch = files.slice(i, i + CONFIG.batchSize)
    batchCount++

    console.log(`\n${"=".repeat(50)}`)
    console.log(`📦 BATCH ${batchCount}/${totalBatches} (files ${i + 1}-${Math.min(i + CONFIG.batchSize, files.length)})`)
    console.log(`${"=".repeat(50)}`)

    for (const file of batch) {
      console.log(`\n📄 Processing: ${file}`)

      try {
        const chunks = await processFile(openrouter, file, dryRun)
        allChunks.push(...chunks)
        processedCount++
      } catch (error) {
        console.error(`  ❌ Error processing ${file}:`, error)
      }
    }

    // Batch cooldown (skip for last batch and dry run)
    if (i + CONFIG.batchSize < files.length && !dryRun) {
      console.log(`\n⏳ Batch ${batchCount} complete. Cooling off for ${CONFIG.batchCooldownMs / 1000}s...`)
      console.log(`📊 Progress: ${processedCount}/${files.length} files (${Math.round(processedCount / files.length * 100)}%), ${allChunks.length} chunks`)
      await sleep(CONFIG.batchCooldownMs)
    }
  }

  // Create output directory
  const outputDir = path.resolve(CONFIG.outputDir)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Write index file
  const indexFile: IndexFile = {
    version: "1.0.0",
    generatedAt: new Date(),
    totalFiles: processedCount,
    totalChunks: allChunks.length,
    chunks: allChunks,
  }

  const outputPath = path.join(outputDir, "contextual-index.json")
  fs.writeFileSync(outputPath, JSON.stringify(indexFile, null, 2))

  // Write individual context files (for easy lookup)
  for (const chunk of allChunks) {
    const contextPath = path.join(
      outputDir,
      chunk.filePath.replace(/\//g, "_").replace(/\.ts$/, `.chunk${chunk.chunkIndex}.json`)
    )
    fs.writeFileSync(contextPath, JSON.stringify(chunk, null, 2))
  }

  console.log("\n" + "=" .repeat(60))
  console.log("  ✅ Contextual Index Generated")
  console.log("=" .repeat(60))
  console.log(`
  📁 Files processed: ${processedCount}
  📦 Chunks generated: ${allChunks.length}
  💾 Output directory: ${outputDir}
  📄 Index file: ${outputPath}
  `)

  // Show sample contexts
  console.log("📝 Sample contexts:\n")
  const samples = allChunks.slice(0, 3)
  for (const sample of samples) {
    console.log(`File: ${sample.filePath}`)
    console.log(`Context: ${sample.context}`)
    console.log()
  }
}

main().catch(console.error)
