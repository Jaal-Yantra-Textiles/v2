/**
 * Test Script: Spec Store
 *
 * Tests the spec embedding store:
 * 1. Load specs from specs/ directory
 * 2. Store embeddings in PgVector
 * 3. Search for relevant specs based on natural language queries
 * 4. Dynamic spec generation
 * 5. Chunked loading for large specs
 * 6. Enhanced natural language examples
 *
 * Usage: npx tsx src/mastra/scripts/test-spec-store.ts
 */

import {
  initSpecStore,
  storeAllSpecs,
  storeAllSpecsChunked,
  generateAndStoreSpec,
  storeDynamicSpecs,
  searchSpecs,
  findRelevantModules,
  getSpecContextForLLM,
  getChunkedSpecContextForLLM,
  getSpecStoreStats,
  debugGetSearchableText,
} from "../services/spec-store"

async function main() {
  console.log("\n=== Spec Store Test (Enhanced) ===\n")

  // 1. Initialize store
  console.log("1. Initializing spec store...")
  await initSpecStore()
  console.log("   Done!")

  // 2. Store all specs (using chunked method for better memory handling)
  console.log("\n2. Storing all specs (chunked)...")
  const count = await storeAllSpecsChunked(10, (stored, total, chunk) => {
    console.log(`   Progress: ${stored}/${total} - Chunk: ${chunk.join(", ")}`)
  })
  console.log(`   Total stored: ${count} specs`)

  // 3. Get stats
  console.log("\n3. Store statistics:")
  const stats = await getSpecStoreStats()
  console.log(`   Total specs: ${stats.totalSpecs}`)
  console.log(`   Index: ${stats.indexName}`)
  console.log(`   Dimension: ${stats.dimension}`)
  console.log(`   Modules: ${stats.moduleNames.join(", ")}`)

  // 3b. Show searchable text for debugging - now includes natural language examples
  console.log("\n3b. Searchable text preview (production_runs):")
  const prodRunsText = await debugGetSearchableText("production_runs")
  if (prodRunsText) {
    // Show natural language examples section
    const nlExamplesStart = prodRunsText.indexOf("Common queries:")
    if (nlExamplesStart >= 0) {
      console.log("   Natural language examples found:")
      console.log("   " + prodRunsText.slice(nlExamplesStart, nlExamplesStart + 400).split(", ").slice(0, 10).join("\n   "))
    }

    // Show query patterns section
    const queryPatternsStart = prodRunsText.indexOf("Cross-entity query patterns")
    if (queryPatternsStart >= 0) {
      console.log("\n   Cross-entity patterns:")
      console.log("   " + prodRunsText.slice(queryPatternsStart, queryPatternsStart + 300).split(". ").join("\n   "))
    }
  }

  // 4. Test semantic search with enhanced natural language queries
  console.log("\n4. Testing semantic search with natural language queries...\n")

  const testQueries = [
    // Original queries
    "Find designs with active production runs",
    "Show me all production runs that are pending approval",
    "Get partners with their payments",

    // NEW: Natural language variations (should now match better)
    "fetch all partners that have feedback",
    "get all production runs",
    "show me designs",
    "list all partners with payments",
    "give me inventory orders",

    // NEW: "that have" patterns
    "partners that have payments",
    "designs that have specifications",

    // NEW: Reverse patterns ("X for Y")
    "feedback for partners",
    "payments for partners",
  ]

  for (const query of testQueries) {
    console.log(`   Query: "${query}"`)

    const results = await searchSpecs(query, 3)

    if (results.length > 0) {
      for (const result of results.slice(0, 2)) {
        const matchIcon =
          result.matchType === "high"
            ? "✓"
            : result.matchType === "moderate"
            ? "~"
            : "✗"
        console.log(
          `   ${matchIcon} ${result.moduleName} (${(result.similarity * 100).toFixed(1)}% - ${result.matchType})`
        )

        // Show enum fields if relevant
        const enumFields = result.metadata?.enumFields || []
        if (enumFields.length > 0) {
          for (const ef of enumFields.slice(0, 2)) {
            console.log(`     - ${ef.name}: [${ef.values.slice(0, 4).join(", ")}...]`)
          }
        }
      }
    } else {
      console.log("   No matches found")
    }

    console.log()
  }

  // 5. Test findRelevantModules
  console.log("5. Testing findRelevantModules...")
  const relevantQuery = "fetch all partners that have feedback"
  const relevant = await findRelevantModules(relevantQuery)
  console.log(`   Query: "${relevantQuery}"`)
  console.log(`   Relevant modules: ${relevant.join(", ") || "none"}`)

  // 6. Test LLM context generation (chunked version)
  console.log("\n6. Testing chunked LLM context generation...")
  const llmContext = await getChunkedSpecContextForLLM("production runs that are pending approval", 2, 10)
  console.log("   Generated context preview (chunked):")
  console.log("   " + llmContext.slice(0, 600).split("\n").join("\n   ") + "...")

  // 7. Test dynamic spec generation
  console.log("\n7. Testing dynamic spec generation...")
  console.log("   Attempting to generate spec for 'feedback' module...")
  const dynamicSpec = await generateAndStoreSpec("feedback")
  if (dynamicSpec) {
    console.log(`   ✓ Generated spec for: ${dynamicSpec.module}`)
    console.log(`     Entity: ${dynamicSpec.dataModel.entityName}`)
    console.log(`     Fields: ${dynamicSpec.dataModel.fields.length}`)
    console.log(`     Relations: ${dynamicSpec.dataModel.relations.length}`)
  } else {
    console.log("   ✗ Could not generate spec (module may not exist or no source files found)")
  }

  console.log("\n=== Test Complete ===\n")
}

main().catch(console.error)
