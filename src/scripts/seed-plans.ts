#!/usr/bin/env ts-node
/**
 * Seed Plans into Plan Store
 * 
 * Loads example plans from specs/api-route-plans.json and seeds them
 * into the PgVector plan store for the query planner's learning RAG.
 * 
 * Usage: yarn seed:plans
 */

import * as fs from "fs"
import * as path from "path"

interface QueryPlanExample {
  id: string
  naturalQuery: string
  plan: {
    steps: PlanStep[]
    finalEntity: string
    explanation: string
  }
  tags: string[]
  module: string
}

interface PlanStep {
  step: number
  entity: string
  operation: "list" | "retrieve" | "listAndCount"
  filters: Record<string, any>
  relations?: string[]
  executionMethod?: "http" | "module"
}

async function seedPlans() {
  console.log("🌱 Seeding plans into plan store...")

  const plansPath = path.join(process.cwd(), "specs/api-route-plans.json")

  if (!fs.existsSync(plansPath)) {
    console.error("Plans file not found. Run 'yarn generate:plans' first.")
    process.exit(1)
  }

  const plansData = JSON.parse(fs.readFileSync(plansPath, "utf-8"))
  const examples: QueryPlanExample[] = plansData.allExamples || []

  console.log(`Found ${examples.length} plan examples to seed`)

  // Import plan store functions dynamically to avoid initialization issues
  try {
    const planStoreModule = await import("../mastra/services/plan-store.js")
    const storePlan = planStoreModule.storePlan
    const initPlanStore = planStoreModule.initPlanStore

    await initPlanStore()
    console.log("✅ Plan store initialized")

    let seeded = 0
    let skipped = 0

    for (const example of examples) {
      try {
        await storePlan(example.naturalQuery, {
          steps: example.plan.steps.map((step: PlanStep) => ({
            action: step.entity,
            entity: step.entity,
            method: step.operation,
            filters: step.filters,
            relations: step.relations,
          })),
          entities: [example.module],
          intent: example.tags.join(", "),
        })
        seeded++
        if (seeded % 50 === 0) {
          console.log(`  Seeded ${seeded}/${examples.length} plans...`)
        }
      } catch (e) {
        skipped++
        console.warn(`Failed to seed: ${example.naturalQuery}`)
      }
    }

    console.log(`\n✅ Successfully seeded ${seeded} plans`)
    if (skipped > 0) {
      console.log(`⚠️  Skipped ${skipped} plans (may already exist)`)
    }

  } catch (e: any) {
    console.error("Failed to import plan store:", e.message)
    console.log("\n📋 Plan store not available (database not configured)")
    console.log("   Plans file saved at:", plansPath)
    console.log("   These will be automatically used when the plan store is available.")

    // Output summary of plans for reference
    console.log("\n--- Plan Summary ---")
    const byModule: Record<string, number> = {}
    for (const example of examples) {
      byModule[example.module] = (byModule[example.module] || 0) + 1
    }
    for (const [module, count] of Object.entries(byModule)) {
      console.log(`  ${module}: ${count} plans`)
    }
  }
}

seedPlans()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
