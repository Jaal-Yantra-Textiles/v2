#!/usr/bin/env node
// Asserts that every custom `./src/modules/<name>` registered in
// medusa-config.ts is also registered in medusa-config.prod.ts.
//
// Why this exists
//   The Dockerfile overwrites medusa-config.ts with medusa-config.prod.ts
//   at build time (see apps/backend/Dockerfile, "Use the production
//   Medusa config for the build"). If you add a new custom module to
//   medusa-config.ts and forget the prod variant, the module is silently
//   missing in prod — `container.resolve(MODULE_KEY)` throws at runtime.
//
// We deliberately don't compare third-party providers (@medusajs/medusa/*,
// @medusajs/draft-order, …) because dev and prod legitimately differ
// (Redis vs in-memory cache/event-bus/workflow-engine, Resend/Mailjet/S3
// only enabled in prod, etc.).
//
// Usage
//   node apps/backend/scripts/check-prod-config-parity.mjs        # check
//   node apps/backend/scripts/check-prod-config-parity.mjs --fix  # append missing
//
// Exits 1 on drift (no --fix) so CI fails the merge.

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(HERE, "..")
const DEV = path.join(BACKEND, "medusa-config.ts")
const PROD = path.join(BACKEND, "medusa-config.prod.ts")

const MODULE_RE = /resolve:\s*"(\.\/src\/modules\/[^"]+)"/g

function extractCustomModules(filePath) {
  const text = readFileSync(filePath, "utf8")
  // Strip block comments + line comments before extracting so commented-out
  // module registrations don't count as "present."
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")

  const found = new Set()
  for (const m of stripped.matchAll(MODULE_RE)) {
    found.add(m[1])
  }
  return found
}

function appendMissingToProd(missing) {
  let text = readFileSync(PROD, "utf8")
  // Find the modules array's closing `]` — the script handles the common
  // case of `\n],\n});` at the file tail. If the file shape changes, this
  // throws explicitly rather than corrupting the config.
  const tailRe = /\n\],\s*\}\);\s*$/
  if (!tailRe.test(text)) {
    throw new Error(
      "Could not locate `\\n],\\n});` at the tail of medusa-config.prod.ts — refusing to auto-edit. Add the missing modules by hand."
    )
  }
  const additions = [...missing]
    .map((m) => `  {\n    resolve: "${m}",\n  },`)
    .join("\n")
  text = text.replace(tailRe, `\n${additions}\n],\n});\n`)
  writeFileSync(PROD, text)
}

const dev = extractCustomModules(DEV)
const prod = extractCustomModules(PROD)
const missing = [...dev].filter((m) => !prod.has(m)).sort()

if (missing.length === 0) {
  console.log("✓ medusa-config.prod.ts registers every custom module from medusa-config.ts")
  process.exit(0)
}

const fix = process.argv.includes("--fix")
console.error(
  `✗ medusa-config.prod.ts is missing ${missing.length} custom module(s) present in medusa-config.ts:`
)
for (const m of missing) console.error(`    ${m}`)

if (fix) {
  appendMissingToProd(missing)
  console.error(
    `\n  → Appended to medusa-config.prod.ts. Review the diff and commit.`
  )
  process.exit(0)
}

console.error(
  `\n  To auto-append: node apps/backend/scripts/check-prod-config-parity.mjs --fix`
)
process.exit(1)
