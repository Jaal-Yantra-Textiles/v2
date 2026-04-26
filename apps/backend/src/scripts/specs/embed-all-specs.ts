#!/usr/bin/env node
/**
 * Embed All Specs Script
 *
 * Inserts all API specs from the specs/ directory into the pgvector store
 * for semantic search functionality.
 *
 * Usage:
 *   npx tsx src/scripts/embed-all-specs.ts
 *
 * Environment:
 *   POSTGRES_CONNECTION_STRING - Database connection string
 *   DATABASE_URL - Alternative database connection string
 */

import * as path from "path"
import * as fs from "fs/promises"

const PROJECT_ROOT = process.cwd()

interface SpecFile {
  name: string
  path: string
  content: any
}

async function main() {
  console.log("=" .repeat(60))
  console.log("🔌 Embedding All Specs into Vector Store")
  console.log("=" .repeat(60))

  const specsDir = path.join(PROJECT_ROOT, "specs")

  // Check if specs directory exists
  try {
    await fs.access(specsDir)
  } catch {
    console.error("❌ Specs directory not found:", specsDir)
    process.exit(1)
  }

  // Find all spec files
  const files = await fs.readdir(specsDir)
  const specFiles = files.filter(f => f.endsWith("-complete-spec.json"))

  console.log(`\n📂 Found ${specFiles.length} spec files`)

  if (specFiles.length === 0) {
    console.log("❌ No spec files found")
    process.exit(1)
  }

  // Load all specs
  console.log("\n📄 Loading specs...")
  const specs: SpecFile[] = []
  for (const file of specFiles) {
    try {
      const filePath = path.join(specsDir, file)
      const content = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(content)
      const moduleName = file.replace("-complete-spec.json", "")
      specs.push({
        name: moduleName,
        path: filePath,
        content: parsed
      })
      console.log(`   ✓ ${moduleName}`)
    } catch (error) {
      console.warn(`   ⚠️  Failed to load ${file}:`, error)
    }
  }

  console.log(`\n✅ Loaded ${specs.length} specs`)

  // Check database connection
  const dbConnection = process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL

  if (!dbConnection) {
    console.log("\n⚠️  Database connection string not found in environment")
    console.log("   To embed specs, set one of:")
    console.log("   - POSTGRES_CONNECTION_STRING")
    console.log("   - DATABASE_URL")
    console.log("\n📋 Specs loaded but NOT embedded. Run with database connection:")
    console.log("   POSTGRES_CONNECTION_STRING=\"...\" npx tsx src/scripts/embed-all-specs.ts")
    console.log("\n📊 Summary of specs to embed:")
    console.log(JSON.stringify({
      totalSpecs: specs.length,
      modules: specs.map(s => s.name)
    }, null, 2))
    return
  }

  console.log("\n🗄️  Database connection found, initializing...")

  // Import services
  let PgVector: any
  try {
    const pgModule = await import("@mastra/pg")
    PgVector = pgModule.PgVector
  } catch (error) {
    console.error("❌ Failed to import PgVector:", error)
    process.exit(1)
  }

  // Initialize pgvector
  const store = new PgVector({ connectionString: dbConnection })
  const INDEX_NAME = "ai_module_specs"
  const EMBEDDING_DIM = 384

  // Create index if needed
  console.log("📦 Creating index if needed...")
  try {
    let exists = false
    try {
      const indexes = await store.listIndexes?.()
      if (Array.isArray(indexes)) {
        exists = indexes.includes(INDEX_NAME)
      }
    } catch {}

    if (!exists) {
      try {
        await store.createIndex?.({
          indexName: INDEX_NAME,
          dimension: EMBEDDING_DIM,
          metric: "cosine",
        })
        console.log("   ✓ Created index:", INDEX_NAME)
      } catch (createError) {
        // Try alternative API
        try {
          await (store as any).createIndex(INDEX_NAME, EMBEDDING_DIM, "cosine")
          console.log("   ✓ Created index:", INDEX_NAME)
        } catch (altError) {
          console.warn("   ⚠️  Could not create index (may already exist):", altError)
        }
      }
    } else {
      console.log("   ✓ Index already exists:", INDEX_NAME)
    }
  } catch (error) {
    console.warn("   ⚠️  Index check warning:", error)
  }

  // Import embedding service
  let embedTexts: (texts: string[]) => Promise<number[][]>
  try {
    // @ts-ignore - mastra paths excluded from tsconfig, resolved at runtime
    const embeddingModule = await import("../mastra/services/embedding-service")
    embedTexts = (embeddingModule as any).embedTexts
  } catch (error) {
    console.error("❌ Failed to import embedding service:", error)
    console.log("\n📌 Make sure dependencies are installed:")
    console.log("   npm install @xenova/transformers")
    process.exit(1)
  }

  // Build searchable text for each spec
  console.log("\n🔨 Building searchable text for each spec...")
  const searchableTexts: string[] = []
  const metadataList: any[] = []
  const ids: string[] = []

  for (const spec of specs) {
    const searchableText = buildSearchableText(spec.content)
    searchableTexts.push(searchableText)
    ids.push(`spec_${spec.name}`)

    // Build metadata
    const metadata = {
      moduleName: spec.content.module,
      entityName: spec.content.dataModel?.entityName || spec.name,
      tableName: spec.content.dataModel?.tableName || spec.name,
      description: spec.content.dataModel?.description || "",
      fieldNames: spec.content.dataModel?.fields?.map((f: any) => f.name) || [],
      relationNames: spec.content.dataModel?.relations?.map((r: any) => r.name) || [],
      enumFields: spec.content.dataModel?.fields
        ?.filter((f: any) => f.enumValues && f.enumValues.length > 0)
        ?.map((f: any) => ({ name: f.name, values: f.enumValues })) || [],
      linkedModules: spec.content.integrationPoints?.links?.map((l: any) => l.targetModule) || [],
      workflowNames: spec.content.workflows?.definitions?.map((w: any) => w.name) || [],
      updatedAt: new Date().toISOString(),
    }
    metadataList.push(metadata)
  }

  console.log(`   ✓ Built ${searchableTexts.length} searchable texts`)

  // Generate embeddings
  console.log("\n🧠 Generating embeddings...")
  console.log("   (This may take a moment for the first run while model loads)")

  try {
    const embeddings = await embedTexts(searchableTexts)
    console.log(`   ✓ Generated ${embeddings.length} embeddings (${embeddings[0]?.length || 0} dimensions each)`)

    // Store in pgvector
    console.log("\n💾 Storing embeddings in vector store...")

    await store.upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      ids,
      metadata: metadataList,
    })

    console.log(`   ✓ Successfully stored ${ids.length} spec embeddings`)

    // Summary
    console.log("\n" + "=".repeat(60))
    console.log("✅ SUCCESS - All specs embedded!")
    console.log("=".repeat(60))
    console.log(`   Total specs embedded: ${specs.length}`)
    console.log(`   Index name: ${INDEX_NAME}`)
    console.log(`   Embedding dimension: ${EMBEDDING_DIM}`)
    console.log("\n📋 Embedded modules:")
    for (const spec of specs) {
      console.log(`   - ${spec.name}`)
    }

  } catch (error) {
    console.error("\n❌ Failed to generate or store embeddings:", error)
    process.exit(1)
  }
}

/**
 * Build searchable text from a spec
 */
function buildSearchableText(spec: any): string {
  const parts: string[] = []

  // Module identity
  parts.push(`Module: ${spec.module}`)
  parts.push(`Entity: ${spec.dataModel?.entityName || spec.module}`)
  parts.push(`Table: ${spec.dataModel?.tableName || spec.module}`)

  // Description
  if (spec.dataModel?.description) {
    parts.push(spec.dataModel.description)
  }

  // Fields
  const fieldNames = spec.dataModel?.fields?.map((f: any) => f.name) || []
  parts.push(`Fields: ${fieldNames.join(", ")}`)

  // Enum fields with values
  const enumFields = spec.dataModel?.fields?.filter((f: any) => f.enumValues && f.enumValues.length > 0) || []
  for (const field of enumFields) {
    parts.push(`${field.name} values: ${field.enumValues.join(", ")}`)
  }

  // Relations
  if (spec.dataModel?.relations?.length > 0) {
    const relationNames = spec.dataModel.relations.map((r: any) => r.name)
    parts.push(`Relations: ${relationNames.join(", ")}`)
  }

  // Module links
  if (spec.integrationPoints?.links?.length > 0) {
    const linkTargets = spec.integrationPoints.links.map((l: any) => l.targetEntity)
    parts.push(`Links to: ${linkTargets.join(", ")}`)
  }

  // Workflows
  if (spec.workflows?.definitions?.length > 0) {
    const workflowNames = spec.workflows.definitions.map((w: any) => w.name)
    parts.push(`Workflows: ${workflowNames.join(", ")}`)
  }

  // Query intelligence - cross-entity patterns
  if (spec.queryIntelligence?.crossEntityPatterns?.length > 0) {
    parts.push("Cross-entity query patterns:")
    for (const pattern of spec.queryIntelligence.crossEntityPatterns) {
      parts.push(pattern.description)
      if (pattern.naturalLanguageExamples?.length > 0) {
        parts.push(pattern.naturalLanguageExamples.join(", "))
      }
    }
  }

  // Semantic mappings
  if (spec.queryIntelligence?.semanticMappings?.length > 0) {
    for (const mapping of spec.queryIntelligence.semanticMappings) {
      for (const [enumValue, userTerms] of Object.entries(mapping.userTerms as Record<string, string[]>)) {
        if (Array.isArray(userTerms) && userTerms.length > 0) {
          parts.push(`${mapping.fieldName} ${enumValue}: ${userTerms.join(", ")}`)
        }
      }
    }
  }

  // Common query patterns
  parts.push("Common queries:")
  const singular = (spec.dataModel?.entityName || spec.module).replace(/s$/, "").toLowerCase()
  const plural = (spec.dataModel?.entityName || spec.module).toLowerCase()
  const prefixes = ["fetch all", "get all", "show me", "list all", "find all", "retrieve all"]
  for (const prefix of prefixes) {
    parts.push(`${prefix} ${plural}`)
  }
  parts.push(`get ${singular}`, `find ${singular}`)

  return parts.join(". ")
}

main().catch(console.error)
