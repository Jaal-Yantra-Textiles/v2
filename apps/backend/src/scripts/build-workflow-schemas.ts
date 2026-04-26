/**
 * build-workflow-schemas.ts
 *
 * Generates workflow-schemas.json at the project root by scanning:
 *   1. src/workflows/**‌/*.ts          — all custom project workflows
 *   2. @medusajs/types/dist/workflow/**‌/*.d.ts  — core Medusa workflow input types
 *      (matched via @medusajs/core-flows/dist/**‌/*.js WorkflowId constants)
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/build-workflow-schemas.ts
 *   OR add to package.json build script:
 *   "build": "medusa build && npx ts-node src/scripts/build-workflow-schemas.ts"
 *
 * Output: workflow-schemas.json (project root)
 * This file is loaded by /admin/visual-flows/metadata in production when
 * source .ts files are not available.
 */

import * as fs from "fs"
import * as path from "path"

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowInputField {
  name: string
  type: "string" | "number" | "boolean" | "date" | "array" | "object" | "id"
  description?: string
  required?: boolean
  placeholder?: string
}

interface SchemaEntry {
  fields: WorkflowInputField[]
  source: "custom_ts" | "core_dts" | "inferred"
  sourceFile?: string
}

type SchemaMap = Record<string, SchemaEntry>

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapTsType(name: string, tsType: string): WorkflowInputField["type"] {
  if (name === "id" || name.endsWith("_id")) return "id"
  const t = tsType.toLowerCase().replace(/\s+/g, "")
  if (t === "date" || name.endsWith("_at") || name.endsWith("_date") || name.includes("date")) return "date"
  if (t === "number" || t === "int" || t === "float") return "number"
  if (t === "boolean" || t === "bool") return "boolean"
  if (t.endsWith("[]") || t.startsWith("array<")) return "array"
  if (t.startsWith("record<") || t.startsWith("{") || t.startsWith("object")) return "object"
  if (t.startsWith("'") || t.startsWith('"') || t.includes("|")) return "string"
  return "string"
}

function defaultPlaceholder(name: string, type: WorkflowInputField["type"]): string {
  if (name === "id" || name.endsWith("_id")) return `{{ $last.${name} }}`
  if (type === "date") return `{{ $trigger.${name} }}`
  if (type === "array") return `{{ $last.${name} }}`
  if (type === "object") return "{}"
  if (type === "number") return "0"
  if (type === "boolean") return "false"
  return `{{ $last.${name} }}`
}

/**
 * Extract the first *Input interface/type from a TypeScript or .d.ts source string.
 */
function extractFields(source: string): WorkflowInputField[] {
  const headerRe = /(?:type|interface)\s+\w*[Ii]nput\w*\s*(?:=\s*)?\{/g
  const headerMatch = headerRe.exec(source)
  if (!headerMatch) return []

  // Find matching closing brace
  let depth = 0
  let start = -1
  let end = -1
  for (let i = headerMatch.index; i < source.length; i++) {
    if (source[i] === "{") { if (depth === 0) start = i; depth++ }
    else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break } }
  }
  if (start === -1 || end === -1) return []

  const body = source.slice(start + 1, end)
  const fields: WorkflowInputField[] = []
  let nestDepth = 0

  for (const line of body.split("\n")) {
    for (const ch of line) {
      if (ch === "{") nestDepth++
      else if (ch === "}") nestDepth--
    }
    if (nestDepth !== 0) continue

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("/**")) continue

    const m = trimmed.match(/^(\w+)(\?)?\s*:\s*(.+?)(?:;)?\s*$/)
    if (!m) continue
    if (!m[1] || m[1] === "type") continue

    // Strip inline comments and trailing semicolons
    let rt = m[3].replace(/\s*\/\/.*$/, "").replace(/\s*;$/, "").trim()
    if (rt === "{" || rt === "(" || rt === "") continue

    const fieldType = mapTsType(m[1], rt)

    // Try to extract JSDoc description above this field (for .d.ts files)
    const jsDocRe = new RegExp(`\\/\\*\\*([\\s\\S]*?)\\*\\/\\s*\\n\\s*${m[1]}\\??\\s*:`)
    const jsDocMatch = source.match(jsDocRe)
    let description: string | undefined
    if (jsDocMatch) {
      description = jsDocMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter(Boolean)
        .join(" ")
    }

    fields.push({
      name: m[1],
      type: fieldType,
      required: !m[2],
      placeholder: defaultPlaceholder(m[1], fieldType),
      ...(description ? { description } : {}),
    })
  }

  return fields
}

// ── 1. Scan custom .ts workflows ──────────────────────────────────────────────

function scanCustomWorkflows(srcDir: string): Map<string, { filePath: string; fields: WorkflowInputField[] }> {
  const result = new Map<string, { filePath: string; fields: WorkflowInputField[] }>()

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) continue
      try {
        const source = fs.readFileSync(full, "utf-8")
        for (const m of source.matchAll(/createWorkflow\(\s*["']([^"']+)["']/g)) {
          const wid = m[1]
          if (result.has(wid)) continue
          const fields = extractFields(source)
          result.set(wid, { filePath: full, fields })
        }
      } catch { /* skip */ }
    }
  }

  walk(srcDir)
  return result
}

// ── 2. Scan core-flows for workflow IDs + match to @medusajs/types .d.ts ──────

function buildDtsSlugIndex(typesWorkflowDir: string): Map<string, string> {
  const slugToFile = new Map<string, string>()

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (e.name.endsWith(".d.ts") && !e.name.endsWith(".d.ts.map")) {
        const slug = e.name.replace(".d.ts", "")
        if (!slugToFile.has(slug)) slugToFile.set(slug, full)
      }
    }
  }

  walk(typesWorkflowDir)
  return slugToFile
}

function scanCoreFlowsWorkflowIds(
  coreFlowsDir: string,
  dtsIndex: Map<string, string>
): Map<string, { dtsFile: string; fields: WorkflowInputField[] }> {
  const result = new Map<string, { dtsFile: string; fields: WorkflowInputField[] }>()
  const idPattern = /WorkflowId\s*=\s*["']([^"']+)["']/g

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith(".js") || e.name.endsWith(".js.map")) continue
      try {
        const content = fs.readFileSync(full, "utf-8")
        idPattern.lastIndex = 0
        for (const m of content.matchAll(idPattern)) {
          const wid = m[1]
          if (result.has(wid)) continue

          // Try several slug transformations to find a matching .d.ts
          const dtsFile = dtsIndex.get(wid)
            ?? dtsIndex.get(wid.replace(/-workflow$/, ""))
            ?? dtsIndex.get(wid.split("-").slice(-2).join("-"))
            ?? null

          if (dtsFile) {
            try {
              const dtsSource = fs.readFileSync(dtsFile, "utf-8")
              const fields = extractFields(dtsSource)
              if (fields.length > 0) {
                result.set(wid, { dtsFile, fields })
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }
  }

  walk(coreFlowsDir)
  return result
}

// ── 3. Name-heuristic fallback ─────────────────────────────────────────────────

function inferFromName(name: string): WorkflowInputField[] {
  const n = name.toLowerCase()
  if (n.includes("create") || n.includes("add")) {
    return [{ name: "data", type: "object", required: true, description: "Fields for the new record", placeholder: "{{ $last }}" }]
  }
  if (n.includes("update") || n.includes("edit") || n.includes("patch")) {
    return [
      { name: "id",   type: "id",     required: true,  placeholder: "{{ $last.id }}" },
      { name: "data", type: "object", required: false, placeholder: "{}" },
    ]
  }
  if (n.includes("delete") || n.includes("remove") || n.includes("archive")) {
    return [{ name: "id", type: "id", required: true, placeholder: "{{ $last.id }}" }]
  }
  if (n.includes("send") || n.includes("notify") || n.includes("email")) {
    return [
      { name: "to",   type: "string", required: true,  placeholder: "{{ $trigger.email }}" },
      { name: "data", type: "object", required: false, placeholder: "{}" },
    ]
  }
  return [
    { name: "id",   type: "id",     required: false, placeholder: "{{ $last.id }}" },
    { name: "data", type: "object", required: false, placeholder: "{}" },
  ]
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const ROOT = process.cwd()
  const output: SchemaMap = {}
  let stats = { custom: 0, core: 0, inferredOnly: 0, total: 0 }

  // ── Custom workflows ──
  const srcWorkflowsDir = path.join(ROOT, "src", "workflows")
  if (fs.existsSync(srcWorkflowsDir)) {
    console.log(`\n[1/3] Scanning custom workflows: ${srcWorkflowsDir}`)
    const customMap = scanCustomWorkflows(srcWorkflowsDir)
    for (const [wid, { filePath, fields }] of customMap) {
      const relFile = filePath.replace(ROOT + "/", "")
      if (fields.length > 0) {
        output[wid] = { fields, source: "custom_ts", sourceFile: relFile }
        stats.custom++
      } else {
        // No Input type found in source — use heuristics
        output[wid] = { fields: inferFromName(wid), source: "inferred", sourceFile: relFile }
        stats.inferredOnly++
      }
    }
    console.log(`   → Found ${customMap.size} custom workflows (${stats.custom} with schemas, ${stats.inferredOnly} inferred)`)
  } else {
    console.log(`[1/3] src/workflows not found — skipping custom workflow scan`)
  }

  // ── Core Medusa workflows ──
  const coreFlowsDir = path.join(ROOT, "node_modules/@medusajs/core-flows/dist")
  const typesWorkflowDir = path.join(ROOT, "node_modules/@medusajs/types/dist/workflow")

  if (fs.existsSync(coreFlowsDir) && fs.existsSync(typesWorkflowDir)) {
    console.log(`\n[2/3] Scanning core-flows from: ${coreFlowsDir}`)
    const dtsIndex = buildDtsSlugIndex(typesWorkflowDir)
    console.log(`   → Indexed ${dtsIndex.size} .d.ts type files`)

    const coreMap = scanCoreFlowsWorkflowIds(coreFlowsDir, dtsIndex)
    for (const [wid, { dtsFile, fields }] of coreMap) {
      if (!output[wid]) { // don't overwrite custom workflows with same name
        const relFile = dtsFile.replace(ROOT + "/", "")
        output[wid] = { fields, source: "core_dts", sourceFile: relFile }
        stats.core++
      }
    }
    console.log(`   → Matched ${coreMap.size} core workflows to .d.ts type files`)
  } else {
    console.log(`[2/3] @medusajs/core-flows or @medusajs/types not found — skipping core scan`)
  }

  // ── All registered core workflows not yet matched — add with heuristics ──
  // (We don't know all core workflow IDs at script time without running the server,
  //  so this only covers the ones found above. The route will cover the rest at runtime.)

  stats.total = Object.keys(output).length
  console.log(`\n[3/3] Writing workflow-schemas.json`)
  console.log(`   Total entries: ${stats.total} (${stats.custom} custom, ${stats.core} core, ${stats.inferredOnly} inferred)`)

  const outputPath = path.join(ROOT, "workflow-schemas.json")
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`\n✓ Wrote ${outputPath}`)
  console.log(`\nSample entries:`)
  const sample = Object.entries(output).slice(0, 5)
  for (const [id, entry] of sample) {
    const fieldNames = entry.fields.map(f => `${f.required ? "*" : ""}${f.name}:${f.type}`).join(", ")
    console.log(`  [${entry.source}] ${id}: ${fieldNames}`)
  }
}

main()
