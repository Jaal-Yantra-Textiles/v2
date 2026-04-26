/**
 * Incremental Contextual Index Update
 *
 * Updates the contextual index by only processing:
 * - New files (not in existing index)
 * - Modified files (content changed since last index)
 * - Removes deleted files from index
 *
 * This is much faster than full regeneration (processes ~10-50 files vs 880 files)
 *
 * Usage:
 *   npx tsx src/scripts/update-contextual-index.ts
 *   npx tsx src/scripts/update-contextual-index.ts --dry-run
 *   npx tsx src/scripts/update-contextual-index.ts --force  # Force re-index all
 */

import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { sync as globSync } from "glob"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  model: "mistralai/devstral-2512:free",
  fallbackModels: [
    "mistralai/devstral-2512:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  chunkSize: 100,
  maxContextTokens: 100,
  batchSize: 5,
  delayBetweenCalls: 500,
  batchCooldownMs: 5000,
  rateLimitCooldownMs: 30000,
  maxRetries: 3,
}

const OUTPUT_DIR = ".contextual-index"
const INDEX_FILE = path.join(OUTPUT_DIR, "contextual-index.json")
const METADATA_FILE = path.join(OUTPUT_DIR, "index-metadata.json")

// File patterns to index
const INCLUDE_PATTERNS = [
  "src/modules/**/*.ts",
  "src/api/**/*.ts",
  "src/workflows/**/*.ts",
  "src/links/**/*.ts",
  "src/mastra/**/*.ts",
]

const EXCLUDE_PATTERNS = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/__tests__/**",
  "**/node_modules/**",
  "**/.medusa/**",
  "**/dist/**",
]

// ============================================================================
// Types
// ============================================================================

interface FileMetadata {
  path: string
  hash: string
  size: number
  mtime: number
  chunksCount: number
}

interface IndexMetadata {
  version: string
  lastUpdated: Date
  totalFiles: number
  totalChunks: number
  files: Record<string, FileMetadata>
}

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

interface ContextualIndex {
  version: string
  generatedAt: Date
  totalFiles: number
  totalChunks: number
  chunks: ContextualChunk[]
}

// ============================================================================
// File Change Detection
// ============================================================================

/**
 * Calculate SHA-256 hash of file content
 */
function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8")
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Get file metadata for change detection
 */
function getFileMetadata(filePath: string): Omit<FileMetadata, "chunksCount"> {
  const stats = fs.statSync(filePath)
  return {
    path: filePath,
    hash: calculateFileHash(filePath),
    size: stats.size,
    mtime: stats.mtimeMs,
  }
}

/**
 * Load existing index metadata
 */
function loadIndexMetadata(): IndexMetadata | null {
  if (!fs.existsSync(METADATA_FILE)) {
    return null
  }

  try {
    const content = fs.readFileSync(METADATA_FILE, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    console.warn("⚠️  Failed to load index metadata:", error)
    return null
  }
}

/**
 * Save index metadata
 */
function saveIndexMetadata(metadata: IndexMetadata): void {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8")
}

/**
 * Detect files that need to be re-indexed
 */
function detectChanges(
  currentFiles: string[],
  metadata: IndexMetadata | null
): {
  newFiles: string[]
  modifiedFiles: string[]
  deletedFiles: string[]
  unchangedFiles: string[]
} {
  const newFiles: string[] = []
  const modifiedFiles: string[] = []
  const unchangedFiles: string[] = []

  // Check each current file
  for (const file of currentFiles) {
    const existingMeta = metadata?.files[file]

    if (!existingMeta) {
      // File is new
      newFiles.push(file)
    } else {
      // Check if file changed
      const currentHash = calculateFileHash(file)
      if (currentHash !== existingMeta.hash) {
        modifiedFiles.push(file)
      } else {
        unchangedFiles.push(file)
      }
    }
  }

  // Find deleted files
  const deletedFiles: string[] = []
  if (metadata) {
    const currentFileSet = new Set(currentFiles)
    for (const file of Object.keys(metadata.files)) {
      if (!currentFileSet.has(file)) {
        deletedFiles.push(file)
      }
    }
  }

  return { newFiles, modifiedFiles, deletedFiles, unchangedFiles }
}

// ============================================================================
// Contextual Chunk Generation (reused from generate-contextual-index.ts)
// ============================================================================

function extractMetadata(filePath: string, content: string) {
  const moduleName = filePath.match(/src\/modules\/([^\/]+)/)?.[1] || null
  const isLink = filePath.includes("/links/")
  const isModel = filePath.includes("/models/") || content.includes("model.define")
  const isService = filePath.includes("service.ts") || content.includes("MedusaService")
  const isWorkflow = filePath.includes("/workflows/")
  const isEndpoint = filePath.includes("/api/") && filePath.includes("route.ts")

  let entityType: string | null = null
  if (isLink) entityType = "link"
  else if (isModel) entityType = "model"
  else if (isService) entityType = "service"
  else if (isWorkflow) entityType = "workflow"
  else if (isEndpoint) entityType = "endpoint"

  const apiPath = isEndpoint
    ? filePath
        .replace(/^src\/api/, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[([^\]]+)\]/g, ":$1")
    : null

  return {
    module: moduleName,
    entityType,
    operation: null,
    apiPath,
    relatedEntities: [],
  }
}

async function generateContextForChunk(
  filePath: string,
  chunkContent: string,
  documentContext: string
): Promise<string> {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })

  const prompt = `You are analyzing a TypeScript file in a Medusa e-commerce codebase.

File: ${filePath}

Full document context:
${documentContext.slice(0, 2000)}

Chunk to contextualize:
${chunkContent}

Generate a 50-100 token contextual summary that explains:
1. What module/feature this code belongs to
2. What this specific code does
3. How it relates to the broader file/system

Format: [Module: X | Type: Y | Op: Z] Short description...

Example: [Module: design | Type: service method | Op: retrieve] Fetches designs with specifications loaded via relations parameter`

  const result = await generateText({
    model: openrouter(CONFIG.model) as any,
    prompt,
    maxTokens: CONFIG.maxContextTokens,
  } as any)

  return result.text.trim()
}

function chunkCode(content: string, chunkSize: number = CONFIG.chunkSize): string[] {
  const lines = content.split("\n")
  const chunks: string[] = []

  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize).join("\n")
    if (chunk.trim()) {
      chunks.push(chunk)
    }
  }

  return chunks
}

// ============================================================================
// Incremental Update
// ============================================================================

async function processFile(
  filePath: string,
  rateLimitState: {
    lastRateLimitTime: number
    consecutiveRateLimits: number
  }
): Promise<ContextualChunk[]> {
  console.log(`\n📄 Processing: ${filePath}`)

  const content = fs.readFileSync(filePath, "utf-8")
  const chunks = chunkCode(content)
  const metadata = extractMetadata(filePath, content)

  console.log(`   Found ${chunks.length} chunks`)

  const contextualChunks: ContextualChunk[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    try {
      const context = await generateContextForChunk(filePath, chunk, content)

      contextualChunks.push({
        filePath,
        chunkIndex: i,
        originalContent: chunk,
        context,
        contextualContent: `${context}\n\n${chunk}`,
        metadata,
        generatedAt: new Date(),
      })

      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayBetweenCalls))
    } catch (error: any) {
      if (error.message?.includes("429") || error.message?.includes("rate limit")) {
        rateLimitState.lastRateLimitTime = Date.now()
        rateLimitState.consecutiveRateLimits++

        const backoffTime =
          CONFIG.rateLimitCooldownMs * Math.pow(3, Math.min(rateLimitState.consecutiveRateLimits - 1, 2))

        console.log(`   ⏳ Rate limited! Waiting ${backoffTime / 1000}s...`)
        await new Promise((resolve) => setTimeout(resolve, backoffTime))

        // Retry this chunk
        i--
        continue
      }

      console.warn(`   ⚠️  Failed to generate context for chunk ${i}:`, error.message)
      // Skip this chunk and continue
    }
  }

  return contextualChunks
}

async function incrementalUpdate(options: { dryRun?: boolean; force?: boolean } = {}) {
  const { dryRun = false, force = false } = options

  console.log("=" .repeat(60))
  console.log("  Incremental Contextual Index Update")
  console.log("=" .repeat(60))
  console.log()

  // Create output directory if needed
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // Get current files
  const allPatterns = INCLUDE_PATTERNS.flatMap((pattern) => globSync(pattern))
  const currentFiles = allPatterns
    .filter((file) => !EXCLUDE_PATTERNS.some((exclude) => file.includes(exclude.replace(/\*\*/g, ""))))
    .filter((file) => fs.existsSync(file))

  console.log(`📊 Found ${currentFiles.length} TypeScript files in codebase`)

  // Load existing metadata and index
  const existingMetadata = force ? null : loadIndexMetadata()
  const existingIndex: ContextualIndex | null =
    !force && fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8")) : null

  if (existingMetadata) {
    console.log(`📋 Loaded existing metadata: ${existingMetadata.totalFiles} files, ${existingMetadata.totalChunks} chunks`)
  }

  // Detect changes
  const changes = detectChanges(currentFiles, existingMetadata)

  console.log()
  console.log("🔍 Change Detection:")
  console.log(`   - New files:       ${changes.newFiles.length}`)
  console.log(`   - Modified files:  ${changes.modifiedFiles.length}`)
  console.log(`   - Deleted files:   ${changes.deletedFiles.length}`)
  console.log(`   - Unchanged files: ${changes.unchangedFiles.length}`)
  console.log()

  const filesToProcess = [...changes.newFiles, ...changes.modifiedFiles]

  if (filesToProcess.length === 0) {
    console.log("✅ Index is up to date! No changes detected.")
    return
  }

  if (dryRun) {
    console.log("🔍 DRY RUN - Would process:")
    filesToProcess.forEach((file) => console.log(`   - ${file}`))
    return
  }

  console.log(`⚡ Processing ${filesToProcess.length} files...`)
  console.log()

  // Process files in batches
  const rateLimitState = {
    lastRateLimitTime: 0,
    consecutiveRateLimits: 0,
  }

  const newChunks: ContextualChunk[] = []

  for (let i = 0; i < filesToProcess.length; i += CONFIG.batchSize) {
    const batch = filesToProcess.slice(i, i + CONFIG.batchSize)
    console.log(`\n📦 Batch ${Math.floor(i / CONFIG.batchSize) + 1}/${Math.ceil(filesToProcess.length / CONFIG.batchSize)}`)

    for (const file of batch) {
      const chunks = await processFile(file, rateLimitState)
      newChunks.push(...chunks)
    }

    // Cooldown between batches
    if (i + CONFIG.batchSize < filesToProcess.length) {
      console.log(`\n⏸️  Batch cooldown (${CONFIG.batchCooldownMs / 1000}s)...`)
      await new Promise((resolve) => setTimeout(resolve, CONFIG.batchCooldownMs))
    }
  }

  // Merge with existing index
  const finalChunks: ContextualChunk[] = []

  // Keep chunks from unchanged files
  if (existingIndex) {
    const unchangedFileSet = new Set(changes.unchangedFiles)
    const unchangedChunks = existingIndex.chunks.filter((chunk) => unchangedFileSet.has(chunk.filePath))
    finalChunks.push(...unchangedChunks)
    console.log(`\n♻️  Kept ${unchangedChunks.length} chunks from ${changes.unchangedFiles.length} unchanged files`)
  }

  // Add new/modified chunks
  finalChunks.push(...newChunks)

  // Build new metadata
  const newMetadata: IndexMetadata = {
    version: "1.0.0",
    lastUpdated: new Date(),
    totalFiles: currentFiles.length,
    totalChunks: finalChunks.length,
    files: {},
  }

  // Add file metadata for all current files
  for (const file of currentFiles) {
    const chunksForFile = finalChunks.filter((c) => c.filePath === file)
    newMetadata.files[file] = {
      ...getFileMetadata(file),
      chunksCount: chunksForFile.length,
    }
  }

  // Save new index
  const newIndex: ContextualIndex = {
    version: "1.0.0",
    generatedAt: new Date(),
    totalFiles: currentFiles.length,
    totalChunks: finalChunks.length,
    chunks: finalChunks,
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(newIndex, null, 2), "utf-8")
  saveIndexMetadata(newMetadata)

  console.log()
  console.log("=" .repeat(60))
  console.log("  ✅ Update Complete!")
  console.log("=" .repeat(60))
  console.log()
  console.log(`📊 Final Statistics:`)
  console.log(`   - Total files:  ${newIndex.totalFiles}`)
  console.log(`   - Total chunks: ${newIndex.totalChunks}`)
  console.log(`   - Processed:    ${filesToProcess.length} files`)
  console.log(`   - Added:        ${newChunks.length} new chunks`)
  console.log(`   - Reused:       ${finalChunks.length - newChunks.length} existing chunks`)
  console.log()
  console.log(`💾 Saved to: ${INDEX_FILE}`)
  console.log(`📋 Metadata: ${METADATA_FILE}`)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")

  if (dryRun) {
    console.log("🔍 Running in DRY RUN mode - no changes will be made\n")
  }

  if (force) {
    console.log("⚠️  FORCE mode - will re-index all files\n")
  }

  await incrementalUpdate({ dryRun, force })
}

main().catch(console.error)
