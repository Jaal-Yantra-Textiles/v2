/**
 * Generate specs for ALL modules with delay between each
 *
 * This script generates complete specs for all custom modules
 * with a configurable delay between each generation so you can
 * inspect the output.
 *
 * Usage: npx tsx src/scripts/generate-all-specs.ts
 *
 * Options via env vars:
 *   DELAY_SECONDS=60 (default: 60 seconds between each)
 *   START_FROM=partner (skip modules before this one)
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

// All modules discovered from src/modules/
const ALL_MODULES = [
  "agreements",
  "aivtwo",
  "analytics",
  "company",
  "custom-s3-provider",
  "designs",
  "email_templates",
  "encryption",
  "etsysync",
  "external_stores",
  "feedback",
  "forms",
  "fullfilled_orders",
  "internal_payments",
  "inventory_orders",
  "media",
  "notes",
  "partner",
  "person",
  "persontype",
  "production_policy",
  "production_runs",
  "raw_material",
  "resend",
  "social-provider",
  "socials",
  "tasks",
  "visual_flows",
  "website",
]

const DELAY_SECONDS = parseInt(process.env.DELAY_SECONDS || "60", 10)
const START_FROM = process.env.START_FROM || ""

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false })
}

async function generateSpec(moduleName: string): Promise<boolean> {
  const startTime = new Date()
  console.log(`\n${"=".repeat(60)}`)
  console.log(`[${formatTime(startTime)}] Generating spec for: ${moduleName}`)
  console.log("=".repeat(60))

  try {
    const output = execSync(
      `npx tsx src/scripts/generate-enhanced-specs.ts ${moduleName}`,
      {
        cwd: "/Users/saranshsharma/Documents/jyt",
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }
    )

    console.log(output)

    // Check if spec was created
    const specPath = path.join(
      "/Users/saranshsharma/Documents/jyt/specs",
      `${moduleName}-complete-spec.json`
    )

    if (fs.existsSync(specPath)) {
      const stats = fs.statSync(specPath)
      console.log(`✓ Spec created: ${specPath}`)
      console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`)

      // Show quick summary
      const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"))
      console.log(`  Fields: ${spec.dataModel?.fields?.length || 0}`)
      console.log(`  Relations: ${spec.dataModel?.relations?.length || 0}`)
      console.log(`  API routes: ${spec.apiRoutes?.length || 0}`)
      console.log(`  Workflows: ${spec.workflows?.length || 0}`)
      console.log(`  Links: ${spec.links?.length || 0}`)

      return true
    } else {
      console.log(`✗ No spec file created for ${moduleName}`)
      return false
    }
  } catch (error: any) {
    console.error(`✗ Error generating spec for ${moduleName}:`)
    console.error(error.stderr || error.message)
    return false
  }
}

async function main() {
  console.log("\n" + "█".repeat(60))
  console.log("  GENERATE SPECS FOR ALL MODULES")
  console.log("█".repeat(60))
  console.log(`\nTotal modules: ${ALL_MODULES.length}`)
  console.log(`Delay between: ${DELAY_SECONDS} seconds`)
  if (START_FROM) {
    console.log(`Starting from: ${START_FROM}`)
  }
  console.log(`Started at: ${formatTime(new Date())}`)

  // Calculate estimated completion time
  const totalSeconds = ALL_MODULES.length * DELAY_SECONDS
  const estimatedEnd = new Date(Date.now() + totalSeconds * 1000)
  console.log(`Estimated completion: ${formatTime(estimatedEnd)}`)

  const results: { module: string; success: boolean }[] = []
  let skipUntilFound = START_FROM !== ""

  for (let i = 0; i < ALL_MODULES.length; i++) {
    const moduleName = ALL_MODULES[i]

    // Skip until we find the START_FROM module
    if (skipUntilFound) {
      if (moduleName === START_FROM) {
        skipUntilFound = false
      } else {
        console.log(`Skipping: ${moduleName}`)
        continue
      }
    }

    const remaining = ALL_MODULES.length - i
    console.log(`\n[${i + 1}/${ALL_MODULES.length}] Processing ${moduleName} (${remaining} remaining)`)

    const success = await generateSpec(moduleName)
    results.push({ module: moduleName, success })

    // Wait before next module (unless it's the last one)
    if (i < ALL_MODULES.length - 1) {
      console.log(`\n⏳ Waiting ${DELAY_SECONDS} seconds before next module...`)
      console.log(`   (You can inspect the spec at: specs/${moduleName}-complete-spec.json)`)
      console.log(`   Next up: ${ALL_MODULES[i + 1]}`)
      await sleep(DELAY_SECONDS)
    }
  }

  // Summary
  console.log("\n" + "█".repeat(60))
  console.log("  GENERATION COMPLETE")
  console.log("█".repeat(60))

  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`\nSuccessful: ${successful.length}`)
  console.log(`Failed: ${failed.length}`)

  if (failed.length > 0) {
    console.log("\nFailed modules:")
    for (const f of failed) {
      console.log(`  - ${f.module}`)
    }
  }

  console.log(`\nAll specs saved to: /Users/saranshsharma/Documents/jyt/specs/`)
  console.log(`Completed at: ${formatTime(new Date())}`)
}

main().catch(console.error)
