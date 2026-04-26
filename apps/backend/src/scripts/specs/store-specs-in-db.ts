/**
 * Store Specs in Database
 *
 * Reads generated spec files from the specs/ directory and stores them
 * in the spec_doc database table. Designed to run during CI after spec generation.
 *
 * Usage:
 *   # As Medusa exec script (preferred, uses container):
 *   medusa exec ./src/scripts/specs/store-specs-in-db.ts
 *
 *   # As standalone script (direct DB, for CI):
 *   npx tsx src/scripts/specs/store-specs-in-db.ts
 */

// @ts-nocheck
import * as fs from "fs/promises"
import * as path from "path"

const SPECS_DIR = process.env.SPECS_DIR || path.join(process.cwd(), "specs")
const VERSION = new Date().toISOString().slice(0, 10) // e.g. "2026-02-07"

interface SpecFile {
  moduleName: string
  specType: "module" | "links" | "relations" | "route_plans"
  content: any
  filePath: string
}

async function discoverSpecs(): Promise<SpecFile[]> {
  const specs: SpecFile[] = []

  // Module specs: specs/<moduleName>-complete-spec.json
  try {
    const files = await fs.readdir(SPECS_DIR)
    for (const file of files) {
      if (file.endsWith("-complete-spec.json")) {
        const moduleName = file.replace("-complete-spec.json", "")
        const filePath = path.join(SPECS_DIR, file)
        const content = JSON.parse(await fs.readFile(filePath, "utf-8"))
        specs.push({ moduleName, specType: "module", content, filePath })
      }
    }
  } catch (err) {
    console.warn("[store-specs] No module spec files found:", err)
  }

  // Link docs: specs/links/module-links.json
  try {
    const linksPath = path.join(SPECS_DIR, "links", "module-links.json")
    const content = JSON.parse(await fs.readFile(linksPath, "utf-8"))
    specs.push({ moduleName: "_links", specType: "links", content, filePath: linksPath })
  } catch {
    console.warn("[store-specs] No link docs found")
  }

  // Relations docs: specs/relations/service-relations.json
  try {
    const relationsPath = path.join(SPECS_DIR, "relations", "service-relations.json")
    const content = JSON.parse(await fs.readFile(relationsPath, "utf-8"))
    specs.push({ moduleName: "_relations", specType: "relations", content, filePath: relationsPath })
  } catch {
    console.warn("[store-specs] No relation docs found")
  }

  // Route plans: specs/api-route-plans.json
  try {
    const routePlansPath = path.join(SPECS_DIR, "api-route-plans.json")
    const content = JSON.parse(await fs.readFile(routePlansPath, "utf-8"))
    specs.push({ moduleName: "_route_plans", specType: "route_plans", content, filePath: routePlansPath })
  } catch {
    console.warn("[store-specs] No route plans found")
  }

  return specs
}

/**
 * Store specs using direct DB connection (for CI / standalone usage).
 */
async function storeViaDirect(specs: SpecFile[]) {
  const connectionString = process.env.DATABASE_URL || process.env.MASTRA_DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL or MASTRA_DATABASE_URL is required")
  }

  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString })

  try {
    // Ensure table exists (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "spec_doc" (
        "id" text NOT NULL,
        "module_name" text NOT NULL,
        "spec_type" text NOT NULL DEFAULT 'module',
        "content" jsonb NOT NULL,
        "version" text NULL,
        "generated_at" timestamptz NOT NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "spec_doc_pkey" PRIMARY KEY ("id")
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_spec_doc_module_name_spec_type_unique"
        ON "spec_doc" ("module_name", "spec_type") WHERE deleted_at IS NULL
    `)

    let upserted = 0
    for (const spec of specs) {
      const id = `spec_${spec.specType}_${spec.moduleName}`
      const now = new Date()

      await pool.query(
        `INSERT INTO spec_doc (id, module_name, spec_type, content, version, generated_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (module_name, spec_type) WHERE deleted_at IS NULL
         DO UPDATE SET content = $4, version = $5, generated_at = $6, updated_at = $7`,
        [id, spec.moduleName, spec.specType, JSON.stringify(spec.content), VERSION, now, now]
      )
      upserted++
      console.log(`  [${spec.specType}] ${spec.moduleName} ← ${path.basename(spec.filePath)}`)
    }

    console.log(`\n[store-specs] Upserted ${upserted} specs into database`)
  } finally {
    await pool.end()
  }
}

/**
 * Store specs using Medusa container (for medusa exec usage).
 */
async function storeViaContainer(container: any, specs: SpecFile[]) {
  const specStore = container.resolve("spec_store")
  let upserted = 0

  for (const spec of specs) {
    const id = `spec_${spec.specType}_${spec.moduleName}`

    // Try to update existing, create if not found
    try {
      const existing = await specStore.listSpecDocs({
        filters: { module_name: spec.moduleName, spec_type: spec.specType },
      })

      if (existing?.length > 0) {
        await specStore.updateSpecDocs({
          id: existing[0].id,
          content: spec.content,
          version: VERSION,
          generated_at: new Date(),
        })
      } else {
        await specStore.createSpecDocs({
          id,
          module_name: spec.moduleName,
          spec_type: spec.specType,
          content: spec.content,
          version: VERSION,
          generated_at: new Date(),
        })
      }

      upserted++
      console.log(`  [${spec.specType}] ${spec.moduleName} ← ${path.basename(spec.filePath)}`)
    } catch (err) {
      console.error(`  [${spec.specType}] ${spec.moduleName} FAILED:`, err)
    }
  }

  console.log(`\n[store-specs] Upserted ${upserted} specs into database`)
}

/**
 * Main entry point.
 * Supports both `medusa exec` (receives ExecArgs) and standalone execution.
 */
export default async function storeSpecsInDb(args?: { container?: any }) {
  console.log("[store-specs] Discovering spec files...")
  const specs = await discoverSpecs()

  if (specs.length === 0) {
    console.warn("[store-specs] No spec files found. Run spec generation first.")
    return
  }

  console.log(`[store-specs] Found ${specs.length} spec files:\n`)

  if (args?.container) {
    try {
      await storeViaContainer(args.container, specs)
    } catch {
      console.log("[store-specs] Container method failed, falling back to direct DB")
      await storeViaDirect(specs)
    }
  } else {
    await storeViaDirect(specs)
  }
}

// Allow standalone execution
if (require.main === module || process.argv[1]?.includes("store-specs-in-db")) {
  storeSpecsInDb()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[store-specs] Fatal error:", err)
      process.exit(1)
    })
}
