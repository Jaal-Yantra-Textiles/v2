/**
 * Generate Index Metadata from Existing Index
 *
 * Creates index-metadata.json from the existing contextual-index.json
 * This allows incremental updates to work with previously generated indexes.
 *
 * Usage:
 *   npx tsx src/scripts/generate-index-metadata.ts
 */

import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"

const OUTPUT_DIR = ".contextual-index"
const INDEX_FILE = path.join(OUTPUT_DIR, "contextual-index.json")
const METADATA_FILE = path.join(OUTPUT_DIR, "index-metadata.json")

interface ContextualChunk {
  filePath: string
  chunkIndex: number
  originalContent: string
  context: string
  generatedAt: Date
}

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

function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8")
  return createHash("sha256").update(content).digest("hex")
}

function main() {
  console.log("=" .repeat(60))
  console.log("  Generate Index Metadata")
  console.log("=" .repeat(60))
  console.log()

  // Load existing index
  if (!fs.existsSync(INDEX_FILE)) {
    console.error("❌ Contextual index not found at:", INDEX_FILE)
    console.log("   Run: npx tsx src/scripts/generate-contextual-index.ts")
    process.exit(1)
  }

  console.log("📂 Loading existing index...")
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"))

  console.log(`   - Total files: ${index.totalFiles}`)
  console.log(`   - Total chunks: ${index.totalChunks}`)
  console.log()

  // Group chunks by file
  const fileChunks = new Map<string, ContextualChunk[]>()
  for (const chunk of index.chunks) {
    if (!fileChunks.has(chunk.filePath)) {
      fileChunks.set(chunk.filePath, [])
    }
    fileChunks.get(chunk.filePath)!.push(chunk)
  }

  console.log("🔍 Generating metadata for indexed files...")

  const metadata: IndexMetadata = {
    version: "1.0.0",
    lastUpdated: new Date(),
    totalFiles: fileChunks.size,
    totalChunks: index.totalChunks,
    files: {},
  }

  let processed = 0
  for (const [filePath, chunks] of fileChunks.entries()) {
    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠️  Skipping missing file: ${filePath}`)
      continue
    }

    try {
      const stats = fs.statSync(filePath)
      metadata.files[filePath] = {
        path: filePath,
        hash: calculateFileHash(filePath),
        size: stats.size,
        mtime: stats.mtimeMs,
        chunksCount: chunks.length,
      }
      processed++

      if (processed % 100 === 0) {
        console.log(`   Processed ${processed}/${fileChunks.size} files...`)
      }
    } catch (error) {
      console.warn(`   ⚠️  Failed to process ${filePath}:`, error)
    }
  }

  // Save metadata
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8")

  console.log()
  console.log("✅ Metadata generated successfully!")
  console.log()
  console.log(`📊 Statistics:`)
  console.log(`   - Files processed: ${processed}`)
  console.log(`   - Total chunks: ${metadata.totalChunks}`)
  console.log()
  console.log(`💾 Saved to: ${METADATA_FILE}`)
  console.log()
  console.log("🚀 You can now use: npx tsx src/scripts/update-contextual-index.ts")
}

main()
