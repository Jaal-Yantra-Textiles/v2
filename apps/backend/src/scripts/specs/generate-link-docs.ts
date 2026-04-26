/**
 * Module Link Documentation Generator
 *
 * This script generates comprehensive documentation for all module links
 * in src/links/ for semantic search and LLM context.
 *
 * The documentation includes:
 * 1. Link relationship description
 * 2. Query examples (graph query patterns)
 * 3. Natural language variations for semantic matching
 *
 * Usage:
 *   npx tsx src/scripts/generate-link-docs.ts [options]
 *
 * Options:
 *   --dry-run           Show parsed links without generating docs
 *   --verbose           Show detailed processing logs
 *   --output <path>     Output directory (default: specs/links)
 */

import fs from "fs"
import path from "path"
import { config } from "dotenv"

// Load environment variables
config()

// Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "mistralai/devstral-2512:free"
const LINKS_PATH = path.join(process.cwd(), "src", "links")
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "specs", "links")

// CLI argument parsing
const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const VERBOSE = args.includes("--verbose")
const OUTPUT_DIR = args.includes("--output")
  ? args[args.indexOf("--output") + 1]
  : DEFAULT_OUTPUT_DIR

// ============================================================================
// Types
// ============================================================================

interface LinkableConfig {
  module: string
  entity: string
  isList: boolean
  filterable?: string[]
  field?: string
}

/**
 * Query capability of a link:
 * - "graph_only": Standard link - use query.graph(), cannot filter by linked entity fields
 * - "index_filterable": Has filterable property - use query.index() to filter across linked entities
 */
type QueryCapability = "graph_only" | "index_filterable"

interface ExtraColumn {
  name: string
  type: string
  nullable: boolean
}

interface ParsedLink {
  fileName: string
  filePath: string
  source: LinkableConfig
  target: LinkableConfig
  extraColumns: ExtraColumn[]
  rawContent: string
  hasComment: boolean
  existingComment?: string
  queryCapability: QueryCapability
}

interface LinkDocumentation {
  linkId: string
  fileName: string
  description: string
  sourceEntity: string
  targetEntity: string
  relationshipType: "one-to-one" | "one-to-many" | "many-to-many"
  queryCapability: QueryCapability
  filterableFields?: string[]
  naturalLanguage: string[]
  queryExamples: {
    description: string
    code: string
    useCase: string
    queryMethod: "graph" | "index"
  }[]
  extraFields?: {
    name: string
    type: string
    description: string
  }[]
}

// ============================================================================
// Helpers
// ============================================================================

function log(message: string, force = false): void {
  if (VERBOSE || force) {
    console.log(message)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Link File Parsing
// ============================================================================

/**
 * Find all link files in src/links/
 */
function findLinkFiles(): string[] {
  const entries = fs.readdirSync(LINKS_PATH, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== "index.ts")
    .map((e) => path.join(LINKS_PATH, e.name))
}

/**
 * Extract module name from import statement
 */
function extractModuleName(importLine: string): { alias: string; modulePath: string; isCore: boolean } | null {
  // Match: import XModule from "path" or import XModule from '@medusajs/...'
  const match = importLine.match(/import\s+(\w+)\s+from\s+["']([^"']+)["']/)
  if (!match) return null

  const [, alias, modulePath] = match
  const isCore = modulePath.includes("@medusajs")

  return { alias, modulePath, isCore }
}

/**
 * Parse a single link file to extract relationship information
 */
function parseLinkFile(filePath: string): ParsedLink | null {
  const content = fs.readFileSync(filePath, "utf-8")
  const fileName = path.basename(filePath, ".ts")

  // Extract existing comment if any
  const commentMatch = content.match(/\/\/\s*(.+)\nexport default defineLink/)
  const existingComment = commentMatch?.[1]?.trim()

  // Extract imports to build module map
  const importLines = content.split("\n").filter((l) => l.trim().startsWith("import"))
  const moduleMap: Record<string, { modulePath: string; isCore: boolean }> = {}

  for (const line of importLines) {
    const result = extractModuleName(line)
    if (result) {
      moduleMap[result.alias] = { modulePath: result.modulePath, isCore: result.isCore }
    }
  }

  // Extract defineLink call
  const defineLinkMatch = content.match(/defineLink\s*\(([\s\S]+?)\)\s*$/m)
  if (!defineLinkMatch) {
    log(`  [SKIP] No defineLink found in ${fileName}`)
    return null
  }

  const defineLinkBody = defineLinkMatch[1]

  // Extract linkable patterns
  // Pattern 1: ModuleX.linkable.entity
  // Pattern 2: { linkable: ModuleX.linkable.entity, isList: true, ... }
  const linkablePattern = /(\w+)\.linkable\.(\w+)/g
  const linkables = [...defineLinkBody.matchAll(linkablePattern)]

  if (linkables.length < 2) {
    log(`  [SKIP] Could not parse linkables in ${fileName}`)
    return null
  }

  // Parse source linkable
  const [sourceAlias, sourceEntity] = [linkables[0][1], linkables[0][2]]
  const sourceModule = moduleMap[sourceAlias]

  // Parse target linkable
  const [targetAlias, targetEntity] = [linkables[1][1], linkables[1][2]]
  const targetModule = moduleMap[targetAlias]

  // Extract isList flags
  const sourceIsList = defineLinkBody.includes(`${sourceAlias}.linkable.${sourceEntity}`) &&
    (defineLinkBody.match(new RegExp(`{[^}]*${sourceAlias}\\.linkable\\.${sourceEntity}[^}]*isList:\\s*true`)) !== null ||
      defineLinkBody.match(new RegExp(`{\\s*linkable:\\s*${sourceAlias}\\.linkable\\.${sourceEntity}[^}]*isList:\\s*true`)) !== null)

  const targetIsList = defineLinkBody.includes(`${targetAlias}.linkable.${targetEntity}`) &&
    (defineLinkBody.match(new RegExp(`{[^}]*${targetAlias}\\.linkable\\.${targetEntity}[^}]*isList:\\s*true`)) !== null ||
      defineLinkBody.match(new RegExp(`{\\s*linkable:\\s*${targetAlias}\\.linkable\\.${targetEntity}[^}]*isList:\\s*true`)) !== null)

  // Extract filterable fields
  const filterableMatch = defineLinkBody.match(/filterable:\s*\[([^\]]+)\]/)
  const filterable = filterableMatch
    ? filterableMatch[1].split(",").map((f) => f.trim().replace(/["']/g, ""))
    : []

  // Extract custom field name
  const fieldMatch = defineLinkBody.match(/field:\s*['"](\w+)['"]/)
  const customField = fieldMatch?.[1]

  // Extract extra columns
  const extraColumns: ExtraColumn[] = []
  const extraColumnsMatch = defineLinkBody.match(/extraColumns:\s*{([^}]+)}/)
  if (extraColumnsMatch) {
    const columnsStr = extraColumnsMatch[1]
    const columnPattern = /(\w+):\s*{\s*type:\s*["'](\w+)["']\s*,\s*nullable:\s*(true|false)\s*}/g
    for (const [, name, type, nullable] of columnsStr.matchAll(columnPattern)) {
      extraColumns.push({ name, type, nullable: nullable === "true" })
    }
  }

  // Derive module names from paths
  const getModuleName = (modulePath: string, _alias: string): string => {
    if (modulePath.includes("@medusajs")) {
      // Core module: @medusajs/medusa/customer -> customer
      const parts = modulePath.split("/")
      return parts[parts.length - 1]
    }
    // Custom module: ../modules/designs -> design
    const parts = modulePath.split("/")
    const moduleName = parts[parts.length - 1]
    return moduleName.replace(/s$/, "") // Remove trailing 's'
  }

  // Determine query capability based on filterable property
  // Links with filterable: use query.index() for cross-entity filtering
  // Links without filterable: use query.graph() only
  const queryCapability: QueryCapability = filterable.length > 0 ? "index_filterable" : "graph_only"

  return {
    fileName,
    filePath,
    source: {
      module: sourceModule ? getModuleName(sourceModule.modulePath, sourceAlias) : sourceAlias.replace("Module", "").toLowerCase(),
      entity: sourceEntity,
      isList: sourceIsList,
      filterable: filterable.length > 0 ? filterable : undefined,
      field: undefined,
    },
    target: {
      module: targetModule ? getModuleName(targetModule.modulePath, targetAlias) : targetAlias.replace("Module", "").toLowerCase(),
      entity: targetEntity,
      isList: targetIsList,
      field: customField,
    },
    extraColumns,
    rawContent: content,
    hasComment: !!existingComment,
    existingComment,
    queryCapability,
  }
}

/**
 * Determine relationship type from isList flags
 */
function getRelationshipType(source: LinkableConfig, target: LinkableConfig): "one-to-one" | "one-to-many" | "many-to-many" {
  if (source.isList && target.isList) return "many-to-many"
  if (source.isList || target.isList) return "one-to-many"
  return "one-to-one"
}

// ============================================================================
// Documentation Generation (LLM)
// ============================================================================

/**
 * Build prompt for LLM to generate link documentation
 */
function buildPrompt(link: ParsedLink): string {
  const relationshipType = getRelationshipType(link.source, link.target)

  return `You are a documentation expert for Medusa 2.x e-commerce platform.
Generate comprehensive documentation for the following module link.

## Link Information
- **File**: ${link.fileName}.ts
- **Source**: ${link.source.module}.${link.source.entity} (isList: ${link.source.isList})
- **Target**: ${link.target.module}.${link.target.entity} (isList: ${link.target.isList})
- **Relationship**: ${relationshipType}
${link.extraColumns.length > 0 ? `- **Extra Columns**: ${link.extraColumns.map((c) => `${c.name} (${c.type})`).join(", ")}` : ""}
${link.existingComment ? `- **Existing Comment**: "${link.existingComment}"` : ""}

## Source Code
\`\`\`typescript
${link.rawContent}
\`\`\`

## Generate JSON Documentation

Return ONLY valid JSON matching this exact structure:
{
  "description": "Clear 1-2 sentence description of what this link connects and why",
  "naturalLanguage": [
    "5-8 different natural language ways a user might ask about this relationship",
    "Include variations like: 'designs for customer', 'customer's designs', 'which customer owns this design'",
    "Include query patterns: 'show designs with their customers', 'get customer linked to design'"
  ],
  "queryExamples": [
    {
      "description": "What this query does",
      "code": "await query.graph({ entity: 'designs', fields: ['*', 'customer.*'] })",
      "useCase": "When you need to..."
    },
    {
      "description": "Reverse query - from target to source",
      "code": "await query.graph({ entity: 'customers', fields: ['*', 'designs.*'] })",
      "useCase": "When you need to..."
    }
  ]${link.extraColumns.length > 0 ? `,
  "extraFields": [
    {
      "name": "field_name",
      "type": "field_type",
      "description": "What this field stores in the link table"
    }
  ]` : ""}
}

## Requirements
1. Description must explain the business purpose, not just technical connection
2. Natural language must include 5-8 variations users might type
3. Query examples must show BOTH directions (source→target AND target→source)
4. Use realistic field names from the source code
5. For extra columns, explain their business purpose

Return ONLY the JSON object, no markdown, no explanation.`
}

/**
 * Call OpenRouter API to generate documentation
 */
async function generateDocWithLLM(link: ParsedLink): Promise<LinkDocumentation | null> {
  if (!OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not found")
    return null
  }

  const prompt = buildPrompt(link)

  try {
    const response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jyt-commerce.com",
        "X-Title": "JYT Link Doc Generator",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are a technical documentation expert. Generate clear, accurate JSON documentation. Return ONLY valid JSON, no markdown or explanation.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API request failed: ${response.status} - ${errorText}`)
      return null
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (data.error) {
      console.error(`API error: ${data.error.message}`)
      return null
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("No content in API response")
      return null
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
    }

    const parsed = JSON.parse(jsonStr)
    const relationshipType = getRelationshipType(link.source, link.target)

    // Add queryMethod to each example based on link's queryCapability
    const queryExamples = (parsed.queryExamples || []).map((ex: { description: string; code: string; useCase: string }) => ({
      ...ex,
      queryMethod: link.queryCapability === "index_filterable" && ex.code.includes("filters") ? "index" : "graph" as const,
    }))

    return {
      linkId: link.fileName,
      fileName: `${link.fileName}.ts`,
      description: parsed.description,
      sourceEntity: `${link.source.module}.${link.source.entity}`,
      targetEntity: `${link.target.module}.${link.target.entity}`,
      relationshipType,
      queryCapability: link.queryCapability,
      filterableFields: link.source.filterable,
      naturalLanguage: parsed.naturalLanguage || [],
      queryExamples,
      extraFields: parsed.extraFields,
    }
  } catch (error) {
    console.error(`Request failed: ${(error as Error).message}`)
    return null
  }
}

/**
 * Generate documentation without LLM (fallback/quick mode)
 */
function generateDocWithoutLLM(link: ParsedLink): LinkDocumentation {
  const relationshipType = getRelationshipType(link.source, link.target)
  const sourceEntity = link.source.entity
  const targetEntity = link.target.entity
  const sourcePlural = `${sourceEntity}s`.toLowerCase()
  const targetPlural = `${targetEntity}s`.toLowerCase()
  const isFilterable = link.queryCapability === "index_filterable"

  // Generate natural language variations
  const naturalLanguage = [
    `${sourceEntity} with ${targetEntity}`,
    `${sourceEntity}'s ${targetEntity}`,
    `${targetEntity} for ${sourceEntity}`,
    `${targetEntity} linked to ${sourceEntity}`,
    `which ${targetEntity} belongs to ${sourceEntity}`,
    `show ${sourceEntity} and its ${targetEntity}`,
    `get ${targetPlural} of ${sourceEntity}`,
  ]

  // Add filterable-specific natural language
  if (isFilterable && link.source.filterable) {
    naturalLanguage.push(
      `filter ${sourcePlural} by ${targetEntity}`,
      `${sourcePlural} where ${targetEntity} matches`,
      `find ${sourcePlural} with specific ${targetEntity}`
    )
  }

  // Generate query examples based on query capability
  const queryExamples: LinkDocumentation["queryExamples"] = [
    {
      description: `Fetch ${sourcePlural} with linked ${targetPlural} (basic)`,
      code: `await query.graph({ entity: '${sourcePlural}', fields: ['*', '${targetEntity.toLowerCase()}.*'] })`,
      useCase: `When you need to display ${sourcePlural} with their associated ${targetPlural}`,
      queryMethod: "graph",
    },
    {
      description: `Fetch single ${sourceEntity} with ${targetEntity}`,
      code: `await query.graph({ entity: '${sourcePlural}', fields: ['*', '${targetEntity.toLowerCase()}.*'], filters: { id: '${sourceEntity.toLowerCase()}_id' } })`,
      useCase: `When you need ${targetEntity} for a specific ${sourceEntity}`,
      queryMethod: "graph",
    },
  ]

  // Add index query examples for filterable links
  if (isFilterable && link.source.filterable) {
    const filterField = link.source.filterable[0] // Use first filterable field as example
    queryExamples.push(
      {
        description: `Filter ${sourcePlural} by ${targetEntity} fields (Index Module)`,
        code: `await query.index({ entity: '${sourceEntity.toLowerCase()}', fields: ['*', '${targetEntity.toLowerCase()}.*'], filters: { ${targetEntity.toLowerCase()}: { ${filterField}: 'value' } } })`,
        useCase: `When you need to filter ${sourcePlural} based on ${targetEntity} properties - REQUIRES filterable link`,
        queryMethod: "index",
      },
      {
        description: `Cross-entity filtering with Index Module`,
        code: `await query.index({ entity: '${sourceEntity.toLowerCase()}', fields: ['*', '${targetEntity.toLowerCase()}.*'], filters: { ${targetEntity.toLowerCase()}: { ${link.source.filterable.join(", ")}: '...' } } })`,
        useCase: `Filterable fields: ${link.source.filterable.join(", ")}`,
        queryMethod: "index",
      }
    )
  }

  // If many-to-many or reverse is useful, add reverse query
  if (relationshipType === "many-to-many" || link.target.isList) {
    queryExamples.push({
      description: `Fetch ${targetPlural} with linked ${sourcePlural} (reverse)`,
      code: `await query.graph({ entity: '${targetPlural}', fields: ['*', '${sourceEntity.toLowerCase()}.*'] })`,
      useCase: `When you need to find which ${sourcePlural} are linked to ${targetPlural}`,
      queryMethod: "graph",
    })
  }

  // Add extra field descriptions if present
  const extraFields = link.extraColumns.map((col) => ({
    name: col.name,
    type: col.type,
    description: `${col.name} stored in the link table (${col.nullable ? "optional" : "required"})`,
  }))

  return {
    linkId: link.fileName,
    fileName: `${link.fileName}.ts`,
    description: link.existingComment || `Links ${link.source.module}.${sourceEntity} to ${link.target.module}.${targetEntity}`,
    sourceEntity: `${link.source.module}.${sourceEntity}`,
    targetEntity: `${link.target.module}.${targetEntity}`,
    relationshipType,
    queryCapability: link.queryCapability,
    filterableFields: link.source.filterable,
    naturalLanguage,
    queryExamples,
    extraFields: extraFields.length > 0 ? extraFields : undefined,
  }
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Generate markdown documentation
 */
function generateMarkdown(docs: LinkDocumentation[]): string {
  const lines: string[] = [
    "# Module Links Documentation",
    "",
    "Auto-generated documentation for Medusa module links.",
    "Use this for semantic search to understand how entities are connected.",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ]

  // Table of contents
  lines.push("## Table of Contents")
  lines.push("")
  for (const doc of docs) {
    lines.push(`- [${doc.linkId}](#${doc.linkId.replace(/-/g, "")})`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")

  // Individual link docs
  for (const doc of docs) {
    lines.push(`## ${doc.linkId}`)
    lines.push("")
    lines.push(`**File:** \`src/links/${doc.fileName}\``)
    lines.push("")
    lines.push(`**Relationship:** ${doc.sourceEntity} ↔ ${doc.targetEntity} (${doc.relationshipType})`)
    lines.push("")

    // Query capability badge
    if (doc.queryCapability === "index_filterable") {
      lines.push(`**Query Capability:** 🔍 **Index Filterable** - Can use \`query.index()\` for cross-entity filtering`)
      lines.push("")
      if (doc.filterableFields && doc.filterableFields.length > 0) {
        lines.push(`**Filterable Fields:** \`${doc.filterableFields.join("`, `")}\``)
        lines.push("")
      }
    } else {
      lines.push(`**Query Capability:** 📊 Graph Only - Use \`query.graph()\` (no cross-entity filtering)`)
      lines.push("")
    }

    lines.push(`### Description`)
    lines.push("")
    lines.push(doc.description)
    lines.push("")

    // Natural language variations
    lines.push(`### Natural Language Queries`)
    lines.push("")
    lines.push("Users might ask:")
    for (const nl of doc.naturalLanguage) {
      lines.push(`- "${nl}"`)
    }
    lines.push("")

    // Query examples - grouped by method
    lines.push(`### Query Examples`)
    lines.push("")

    const graphExamples = doc.queryExamples.filter(ex => ex.queryMethod === "graph")
    const indexExamples = doc.queryExamples.filter(ex => ex.queryMethod === "index")

    if (graphExamples.length > 0) {
      lines.push("#### Using `query.graph()` (always available)")
      lines.push("")
      for (const ex of graphExamples) {
        lines.push(`**${ex.description}**`)
        lines.push("")
        lines.push("```typescript")
        lines.push(ex.code)
        lines.push("```")
        lines.push("")
        lines.push(`> ${ex.useCase}`)
        lines.push("")
      }
    }

    if (indexExamples.length > 0) {
      lines.push("#### Using `query.index()` (requires filterable link)")
      lines.push("")
      lines.push("> ⚠️ These queries ONLY work because this link has `filterable` defined!")
      lines.push("")
      for (const ex of indexExamples) {
        lines.push(`**${ex.description}**`)
        lines.push("")
        lines.push("```typescript")
        lines.push(ex.code)
        lines.push("```")
        lines.push("")
        lines.push(`> ${ex.useCase}`)
        lines.push("")
      }
    }

    // Extra fields
    if (doc.extraFields && doc.extraFields.length > 0) {
      lines.push(`### Link Table Fields`)
      lines.push("")
      lines.push("| Field | Type | Description |")
      lines.push("|-------|------|-------------|")
      for (const field of doc.extraFields) {
        lines.push(`| ${field.name} | ${field.type} | ${field.description} |`)
      }
      lines.push("")
    }

    lines.push("---")
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Generate JSON for embedding/semantic search
 */
function generateJSON(docs: LinkDocumentation[]): object {
  const indexFilterable = docs.filter(d => d.queryCapability === "index_filterable")
  const graphOnly = docs.filter(d => d.queryCapability === "graph_only")

  return {
    _meta: {
      generated: new Date().toISOString(),
      totalLinks: docs.length,
      purpose: "Semantic search index for module link relationships",
      summary: {
        indexFilterable: indexFilterable.length,
        graphOnly: graphOnly.length,
        description: "Links with 'index_filterable' can use query.index() for cross-entity filtering. Links with 'graph_only' can only use query.graph().",
      },
    },
    links: docs.map((doc) => ({
      id: doc.linkId,
      file: `src/links/${doc.fileName}`,
      source: doc.sourceEntity,
      target: doc.targetEntity,
      relationship: doc.relationshipType,
      // Query capability info - critical for LLM to know how to query
      queryCapability: doc.queryCapability,
      filterableFields: doc.filterableFields || null,
      canUseIndexQuery: doc.queryCapability === "index_filterable",
      description: doc.description,
      searchTerms: doc.naturalLanguage,
      queries: {
        graph: doc.queryExamples.filter(q => q.queryMethod === "graph"),
        index: doc.queryExamples.filter(q => q.queryMethod === "index"),
      },
      extraFields: doc.extraFields,
      // Flattened text for embedding
      embeddingText: [
        doc.description,
        doc.queryCapability === "index_filterable" ? "filterable index query cross-entity filtering" : "graph query only",
        doc.filterableFields ? `filterable fields: ${doc.filterableFields.join(" ")}` : "",
        ...doc.naturalLanguage,
        ...doc.queryExamples.map((q) => q.description),
      ].filter(Boolean).join(" | "),
    })),
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  console.log("=".repeat(60))
  console.log("  Module Link Documentation Generator")
  console.log("=".repeat(60))
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (parse only)" : "GENERATE DOCS"}`)
  console.log(`Output: ${OUTPUT_DIR}`)
  console.log(`LLM: ${OPENROUTER_API_KEY ? "Available" : "Not configured (using templates)"}`)
  console.log("")

  // Find all link files
  console.log("Scanning src/links/...")
  const linkFiles = findLinkFiles()
  console.log(`Found ${linkFiles.length} link files`)
  console.log("")

  // Parse all link files
  console.log("Parsing link definitions...")
  const parsedLinks: ParsedLink[] = []

  for (const filePath of linkFiles) {
    const fileName = path.basename(filePath, ".ts")
    log(`  Parsing: ${fileName}`)

    const parsed = parseLinkFile(filePath)
    if (parsed) {
      parsedLinks.push(parsed)
      log(`    ✓ ${parsed.source.module}.${parsed.source.entity} → ${parsed.target.module}.${parsed.target.entity}`)
    }
  }

  console.log(`Successfully parsed ${parsedLinks.length} links`)
  console.log("")

  if (DRY_RUN) {
    console.log("Parsed Links Summary:")
    console.log("-".repeat(60))
    for (const link of parsedLinks) {
      const relType = getRelationshipType(link.source, link.target)
      const capability = link.queryCapability === "index_filterable" ? "🔍 Index Filterable" : "📊 Graph Only"
      console.log(`${link.fileName}:`)
      console.log(`  ${link.source.module}.${link.source.entity} ↔ ${link.target.module}.${link.target.entity}`)
      console.log(`  Type: ${relType}`)
      console.log(`  Query: ${capability}`)
      if (link.source.filterable) {
        console.log(`  Filterable: ${link.source.filterable.join(", ")}`)
      }
      if (link.extraColumns.length > 0) {
        console.log(`  Extra columns: ${link.extraColumns.map((c) => c.name).join(", ")}`)
      }
      console.log("")
    }

    // Summary stats
    const indexCount = parsedLinks.filter(l => l.queryCapability === "index_filterable").length
    const graphCount = parsedLinks.filter(l => l.queryCapability === "graph_only").length
    console.log("-".repeat(60))
    console.log(`Total: ${parsedLinks.length} links`)
    console.log(`  🔍 Index Filterable: ${indexCount} (can use query.index())`)
    console.log(`  📊 Graph Only: ${graphCount} (use query.graph())`)
    return
  }

  // Generate documentation
  console.log("Generating documentation...")
  const docs: LinkDocumentation[] = []
  const useLLM = !!OPENROUTER_API_KEY

  for (let i = 0; i < parsedLinks.length; i++) {
    const link = parsedLinks[i]
    console.log(`[${i + 1}/${parsedLinks.length}] ${link.fileName}`)

    let doc: LinkDocumentation | null

    if (useLLM) {
      doc = await generateDocWithLLM(link)
      if (!doc) {
        console.log(`  ⚠ LLM failed, using template`)
        doc = generateDocWithoutLLM(link)
      } else {
        console.log(`  ✓ Generated with LLM`)
      }
      // Rate limiting
      await sleep(2000)
    } else {
      doc = generateDocWithoutLLM(link)
      console.log(`  ✓ Generated with template`)
    }

    docs.push(doc)
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // Write markdown
  const markdown = generateMarkdown(docs)
  const mdPath = path.join(OUTPUT_DIR, "module-links.md")
  fs.writeFileSync(mdPath, markdown)
  console.log(`\n✓ Markdown: ${mdPath}`)

  // Write JSON
  const json = generateJSON(docs)
  const jsonPath = path.join(OUTPUT_DIR, "module-links.json")
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2))
  console.log(`✓ JSON: ${jsonPath}`)

  // Summary
  console.log("")
  console.log("=".repeat(60))
  console.log("  Summary")
  console.log("=".repeat(60))
  console.log(`Total links documented: ${docs.length}`)
  console.log("")
  console.log(`Query Capabilities:`)
  const indexFilterableCount = docs.filter(d => d.queryCapability === "index_filterable").length
  const graphOnlyCount = docs.filter(d => d.queryCapability === "graph_only").length
  console.log(`  🔍 Index Filterable: ${indexFilterableCount} (can filter across entities with query.index())`)
  console.log(`  📊 Graph Only: ${graphOnlyCount} (use query.graph(), no cross-entity filtering)`)
  console.log("")
  console.log(`Relationship types:`)
  const types = { "one-to-one": 0, "one-to-many": 0, "many-to-many": 0 }
  for (const doc of docs) {
    types[doc.relationshipType]++
  }
  console.log(`  - One-to-One: ${types["one-to-one"]}`)
  console.log(`  - One-to-Many: ${types["one-to-many"]}`)
  console.log(`  - Many-to-Many: ${types["many-to-many"]}`)
  console.log("")
  console.log("Output files ready for semantic search indexing!")
}

// Execute
main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
