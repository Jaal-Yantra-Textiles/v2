/**
 * Service Relations Documentation Generator
 *
 * This script generates comprehensive documentation for MODEL RELATIONS
 * (hasMany, hasOne, belongsTo) within modules that can be queried via service calls.
 *
 * Key difference from module links:
 * - Module Links (src/links/*.ts): Cross-module relationships → use query.graph()
 * - Model Relations (model.hasMany/hasOne/belongsTo): Same-module relationships → use service.list({ relations: [...] })
 *
 * Usage:
 *   npx tsx src/scripts/generate-service-relations-docs.ts [options]
 *
 * Options:
 *   --dry-run           Show parsed relations without generating docs
 *   --verbose           Show detailed processing logs
 *   --output <path>     Output directory (default: specs/relations)
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
const MODULES_PATH = path.join(process.cwd(), "src", "modules")
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "specs", "relations")

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

type RelationType = "hasMany" | "hasOne" | "belongsTo"

interface ModelRelation {
  name: string
  type: RelationType
  targetModel: string
  mappedBy: string
  nullable: boolean
}

interface ParsedModel {
  moduleName: string
  modelName: string
  tableName: string
  filePath: string
  relations: ModelRelation[]
  rawContent: string
}

interface RelationDocumentation {
  moduleId: string
  moduleName: string
  modelName: string
  serviceName: string
  relations: {
    name: string
    type: RelationType
    targetModel: string
    description: string
    naturalLanguage: string[]
    queryExamples: {
      method: "list" | "retrieve" | "listAndCount"
      description: string
      code: string
      useCase: string
    }[]
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

function toPascalCase(str: string): string {
  return str.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())
}

/**
 * Convert model name to service name (camelCase + Service)
 * AgreementResponse -> agreementResponseService
 * Design -> designService
 */
function toServiceName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1) + "Service"
}

/**
 * Get method suffix from model name
 * Design -> Designs (plural) or Design (singular)
 * AgreementResponse -> AgreementResponses or AgreementResponse
 * Note: retrieve uses singular, all others use plural
 */
function toMethodName(modelName: string, plural: boolean): string {
  return plural ? `${modelName}s` : modelName
}

// ============================================================================
// Model File Parsing
// ============================================================================

/**
 * Find all model files in src/modules
 */
function findModelFiles(): string[] {
  const modelFiles: string[] = []

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Only look in models/ subdirectory
        if (entry.name === "models") {
          const modelDir = fs.readdirSync(fullPath, { withFileTypes: true })
          for (const modelFile of modelDir) {
            if (modelFile.isFile() && modelFile.name.endsWith(".ts") && modelFile.name !== "index.ts") {
              modelFiles.push(path.join(fullPath, modelFile.name))
            }
          }
        } else if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "migrations") {
          walkDir(fullPath)
        }
      }
    }
  }

  walkDir(MODULES_PATH)
  return modelFiles
}

/**
 * Parse a model file to extract relations
 */
function parseModelFile(filePath: string): ParsedModel | null {
  const content = fs.readFileSync(filePath, "utf-8")
  const fileName = path.basename(filePath, ".ts")

  // Extract module name from path
  const pathParts = filePath.split(path.sep)
  const modulesIndex = pathParts.indexOf("modules")
  const moduleName = pathParts[modulesIndex + 1]

  // Find model.define() call
  const defineMatch = content.match(/model\.define\s*\(\s*["']([^"']+)["']\s*,\s*\{([\s\S]*?)\}\s*\)/)
  if (!defineMatch) {
    log(`  [SKIP] No model.define found in ${fileName}`)
    return null
  }

  const [, tableName, modelBody] = defineMatch

  // Extract model name from export default or file name
  const exportMatch = content.match(/const\s+(\w+)\s*=\s*model\.define/)
  const modelName = exportMatch ? exportMatch[1] : toPascalCase(fileName)

  // Parse relations
  const relations: ModelRelation[] = []

  // hasMany pattern
  const hasManyPattern = /(\w+):\s*model\.hasMany\s*\(\s*\(\)\s*=>\s*(\w+)\s*,\s*\{\s*mappedBy:\s*["'](\w+)["']\s*\}\s*\)/g
  for (const [, name, targetModel, mappedBy] of content.matchAll(hasManyPattern)) {
    relations.push({ name, type: "hasMany", targetModel, mappedBy, nullable: false })
  }

  // hasOne pattern
  const hasOnePattern = /(\w+):\s*model\.hasOne\s*\(\s*\(\)\s*=>\s*(\w+)\s*,\s*\{\s*mappedBy:\s*["'](\w+)["']\s*\}\s*\)/g
  for (const [, name, targetModel, mappedBy] of content.matchAll(hasOnePattern)) {
    relations.push({ name, type: "hasOne", targetModel, mappedBy, nullable: false })
  }

  // belongsTo pattern (can be nullable)
  const belongsToPattern = /(\w+):\s*model\.belongsTo\s*\(\s*\(\)\s*=>\s*(\w+)\s*,\s*\{[\s\S]*?mappedBy:\s*["'](\w+)["'][\s\S]*?\}\s*\)(\.nullable\(\))?/g
  for (const [, name, targetModel, mappedBy, nullable] of content.matchAll(belongsToPattern)) {
    relations.push({ name, type: "belongsTo", targetModel, mappedBy, nullable: !!nullable })
  }

  if (relations.length === 0) {
    log(`  [SKIP] No relations found in ${fileName}`)
    return null
  }

  return {
    moduleName,
    modelName,
    tableName,
    filePath,
    relations,
    rawContent: content,
  }
}

// ============================================================================
// Documentation Generation (LLM)
// ============================================================================

/**
 * Build prompt for LLM to generate relation documentation
 */
function buildPrompt(model: ParsedModel): string {
  const relationsInfo = model.relations.map(r =>
    `- ${r.name}: ${r.type} → ${r.targetModel} (mappedBy: "${r.mappedBy}"${r.nullable ? ", nullable" : ""})`
  ).join("\n")

  return `You are a documentation expert for Medusa 2.x e-commerce platform.
Generate comprehensive documentation for service calls with model relations.

## Model Information
- **Module**: ${model.moduleName}
- **Model**: ${model.modelName}
- **Table**: ${model.tableName}
- **Service**: ${toServiceName(model.modelName)}

## Relations (within same module - use service calls, NOT query.graph())
${relationsInfo}

## Source Code
\`\`\`typescript
${model.rawContent}
\`\`\`

## IMPORTANT: Service Calls vs Query.graph()

These are MODEL RELATIONS within the same module. They should be queried using SERVICE CALLS:
- ✅ service.list({}, { relations: ['relationName'] })
- ✅ service.retrieve(id, { relations: ['relationName'] })
- ❌ query.graph() is for MODULE LINKS (cross-module), NOT these!

## Generate JSON Documentation

Return ONLY valid JSON matching this exact structure:
{
  "relations": [
    {
      "name": "relationName",
      "description": "What this relation represents and when to use it",
      "naturalLanguage": [
        "5-8 ways users might ask about this relation",
        "Include: 'design with specifications', 'get design's specs', etc."
      ],
      "queryExamples": [
        {
          "method": "list",
          "description": "List all with relation",
          "code": "await ${toServiceName(model.modelName)}.list${toMethodName(model.modelName, true)}({}, { relations: ['relationName'] })",
          "useCase": "When you need..."
        },
        {
          "method": "retrieve",
          "description": "Get single with relation",
          "code": "await ${toServiceName(model.modelName)}.retrieve${toMethodName(model.modelName, false)}(id, { relations: ['relationName'] })",
          "useCase": "When you need..."
        }
      ]
    }
  ]
}

Return ONLY the JSON object, no markdown, no explanation.`
}

/**
 * Call OpenRouter API to generate documentation
 */
async function generateDocWithLLM(model: ParsedModel): Promise<RelationDocumentation | null> {
  if (!OPENROUTER_API_KEY) {
    return generateDocWithoutLLM(model)
  }

  const prompt = buildPrompt(model)

  try {
    const response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jyt-commerce.com",
        "X-Title": "JYT Service Relations Doc Generator",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "You are a technical documentation expert. Generate clear, accurate JSON documentation for Medusa service calls. Return ONLY valid JSON, no markdown or explanation.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 3000,
      }),
    })

    if (!response.ok) {
      console.error(`API request failed: ${response.status}`)
      return generateDocWithoutLLM(model)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (data.error || !data.choices?.[0]?.message?.content) {
      return generateDocWithoutLLM(model)
    }

    let jsonStr = data.choices[0].message.content.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
    }

    const parsed = JSON.parse(jsonStr)
    const serviceName = toServiceName(model.modelName)
    const listMethod = `list${toMethodName(model.modelName, true)}`
    const retrieveMethod = `retrieve${toMethodName(model.modelName, false)}`
    const listAndCountMethod = `listAndCount${toMethodName(model.modelName, true)}`

    return {
      moduleId: model.moduleName,
      moduleName: model.moduleName,
      modelName: model.modelName,
      serviceName,
      relations: model.relations.map((rel, i) => {
        // Use LLM for description and natural language only
        // Generate query examples programmatically with correct method names
        const modelLower = model.modelName.toLowerCase()
        const queryExamples: RelationDocumentation["relations"][0]["queryExamples"] = [
          {
            method: "list",
            description: `List all ${model.modelName}s with their ${rel.name}`,
            code: `await ${serviceName}.${listMethod}({}, { relations: ['${rel.name}'] })`,
            useCase: `When you need to display all ${model.modelName}s with their associated ${rel.targetModel}`,
          },
          {
            method: "list",
            description: `Filter ${model.modelName}s and include ${rel.name}`,
            code: `await ${serviceName}.${listMethod}(\n  { id: ['${modelLower}_1', '${modelLower}_2'] },\n  { relations: ['${rel.name}'] }\n)`,
            useCase: `When you need specific ${model.modelName}s by ID with their ${rel.name}`,
          },
          {
            method: "retrieve",
            description: `Get single ${model.modelName} with ${rel.name}`,
            code: `await ${serviceName}.${retrieveMethod}(id, { relations: ['${rel.name}'] })`,
            useCase: `When you need a specific ${model.modelName}'s ${rel.name} details`,
          },
          {
            method: "listAndCount",
            description: `Paginate ${model.modelName}s with ${rel.name} relation`,
            code: `const [items, count] = await ${serviceName}.${listAndCountMethod}(\n  { /* filters */ },\n  { relations: ['${rel.name}'], take: 20, skip: 0 }\n)`,
            useCase: `When you need pagination with total count and related ${rel.targetModel}`,
          },
        ]

        return {
          name: rel.name,
          type: rel.type,
          targetModel: rel.targetModel,
          description: parsed.relations?.[i]?.description || `${rel.type} relation to ${rel.targetModel}`,
          naturalLanguage: parsed.relations?.[i]?.naturalLanguage || [],
          queryExamples,
        }
      }),
    }
  } catch (error) {
    console.error(`Request failed: ${(error as Error).message}`)
    return generateDocWithoutLLM(model)
  }
}

/**
 * Generate documentation without LLM (template-based)
 */
function generateDocWithoutLLM(model: ParsedModel): RelationDocumentation {
  const serviceName = toServiceName(model.modelName)
  const listMethod = `list${toMethodName(model.modelName, true)}`
  const retrieveMethod = `retrieve${toMethodName(model.modelName, false)}`
  const listAndCountMethod = `listAndCount${toMethodName(model.modelName, true)}`

  return {
    moduleId: model.moduleName,
    moduleName: model.moduleName,
    modelName: model.modelName,
    serviceName,
    relations: model.relations.map((rel) => {
      const targetLower = rel.targetModel.toLowerCase()
      const modelLower = model.modelName.toLowerCase()

      // Generate natural language variations
      const naturalLanguage = [
        `${modelLower} with ${rel.name}`,
        `${modelLower}'s ${rel.name}`,
        `get ${rel.name} for ${modelLower}`,
        `show ${modelLower} including ${rel.name}`,
        `${modelLower} and its ${rel.name}`,
        `fetch ${modelLower} ${rel.name}`,
        `list ${modelLower} with related ${targetLower}`,
      ]

      // Generate query examples
      const queryExamples: RelationDocumentation["relations"][0]["queryExamples"] = [
        {
          method: "list",
          description: `List all ${model.modelName}s with their ${rel.name}`,
          code: `await ${serviceName}.${listMethod}({}, { relations: ['${rel.name}'] })`,
          useCase: `When you need to display all ${model.modelName}s with their associated ${rel.targetModel}`,
        },
        {
          method: "retrieve",
          description: `Get single ${model.modelName} with ${rel.name}`,
          code: `await ${serviceName}.${retrieveMethod}(id, { relations: ['${rel.name}'] })`,
          useCase: `When you need a specific ${model.modelName}'s ${rel.name} details`,
        },
        {
          method: "listAndCount",
          description: `List with count and ${rel.name} relation`,
          code: `const [items, count] = await ${serviceName}.${listAndCountMethod}({}, { relations: ['${rel.name}'] })`,
          useCase: `When you need pagination with total count and related ${rel.targetModel}`,
        },
      ]

      // Add filter example
      queryExamples.push({
        method: "list",
        description: `Filter ${model.modelName}s and include ${rel.name}`,
        code: `await ${serviceName}.${listMethod}({ status: 'active' }, { relations: ['${rel.name}'], select: ['id', 'name'] })`,
        useCase: `When you need filtered results with specific fields and relations`,
      })

      return {
        name: rel.name,
        type: rel.type,
        targetModel: rel.targetModel,
        description: `${rel.type === "hasMany" ? "One-to-many" : rel.type === "hasOne" ? "One-to-one" : "Many-to-one"} relation from ${model.modelName} to ${rel.targetModel}`,
        naturalLanguage,
        queryExamples,
      }
    }),
  }
}

// ============================================================================
// Output Generation
// ============================================================================

/**
 * Generate markdown documentation
 */
function generateMarkdown(docs: RelationDocumentation[]): string {
  const lines: string[] = [
    "# Service Relations Documentation",
    "",
    "Auto-generated documentation for **model relations** within modules.",
    "",
    "## ⚠️ IMPORTANT: Service Calls vs Query.graph()",
    "",
    "| Type | Location | Query Method | Example |",
    "|------|----------|--------------|---------|",
    "| **Model Relations** | `model.hasMany/hasOne/belongsTo` | `service.listModels({ relations: [...] })` | `designService.listDesigns({}, { relations: ['specifications'] })` |",
    "| **Module Links** | `src/links/*.ts` | `query.graph()` or `query.index()` | `query.graph({ entity: 'designs', fields: ['*', 'customer.*'] })` |",
    "",
    "This documentation covers **Model Relations** - use SERVICE CALLS to query these!",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ]

  // Table of contents by module
  lines.push("## Table of Contents")
  lines.push("")
  const moduleGroups = new Map<string, RelationDocumentation[]>()
  for (const doc of docs) {
    if (!moduleGroups.has(doc.moduleName)) {
      moduleGroups.set(doc.moduleName, [])
    }
    moduleGroups.get(doc.moduleName)!.push(doc)
  }

  for (const [moduleName, moduleDocs] of moduleGroups) {
    lines.push(`### ${moduleName}`)
    for (const doc of moduleDocs) {
      lines.push(`- [${doc.modelName}](#${doc.modelName.toLowerCase()})`)
    }
    lines.push("")
  }

  lines.push("---")
  lines.push("")

  // Individual model docs
  for (const doc of docs) {
    lines.push(`## ${doc.modelName}`)
    lines.push("")
    lines.push(`**Module:** \`${doc.moduleName}\``)
    lines.push(`**Service:** \`${doc.serviceName}\``)
    lines.push("")

    for (const rel of doc.relations) {
      lines.push(`### ${rel.name}`)
      lines.push("")
      lines.push(`**Type:** \`${rel.type}\` → ${rel.targetModel}`)
      lines.push("")
      lines.push(rel.description)
      lines.push("")

      // Natural language
      lines.push("**Users might ask:**")
      for (const nl of rel.naturalLanguage.slice(0, 5)) {
        lines.push(`- "${nl}"`)
      }
      lines.push("")

      // Query examples
      lines.push("**Service Call Examples:**")
      lines.push("")
      for (const ex of rel.queryExamples) {
        lines.push(`**${ex.description}** (\`${ex.method}\`)`)
        lines.push("")
        lines.push("```typescript")
        lines.push(ex.code)
        lines.push("```")
        lines.push("")
        lines.push(`> ${ex.useCase}`)
        lines.push("")
      }
    }

    lines.push("---")
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Generate JSON for embedding/semantic search
 */
function generateJSON(docs: RelationDocumentation[]): object {
  const totalRelations = docs.reduce((sum, doc) => sum + doc.relations.length, 0)
  const hasManyCount = docs.reduce((sum, doc) =>
    sum + doc.relations.filter(r => r.type === "hasMany").length, 0)
  const hasOneCount = docs.reduce((sum, doc) =>
    sum + doc.relations.filter(r => r.type === "hasOne").length, 0)
  const belongsToCount = docs.reduce((sum, doc) =>
    sum + doc.relations.filter(r => r.type === "belongsTo").length, 0)

  return {
    _meta: {
      generated: new Date().toISOString(),
      totalModules: docs.length,
      totalRelations,
      purpose: "Semantic search index for service-based model relations",
      summary: {
        hasMany: hasManyCount,
        hasOne: hasOneCount,
        belongsTo: belongsToCount,
        description: "Model relations WITHIN modules - query using service.list/retrieve({ relations: [...] }), NOT query.graph()",
      },
    },
    modules: docs.map((doc) => ({
      module: doc.moduleName,
      model: doc.modelName,
      service: doc.serviceName,
      relations: doc.relations.map((rel) => ({
        name: rel.name,
        type: rel.type,
        target: rel.targetModel,
        description: rel.description,
        searchTerms: rel.naturalLanguage,
        queryExamples: rel.queryExamples,
        // Flattened text for embedding
        embeddingText: [
          `${doc.modelName} ${rel.name} ${rel.type} ${rel.targetModel}`,
          rel.description,
          "service call relations parameter",
          `${doc.serviceName}.list ${doc.serviceName}.retrieve`,
          ...rel.naturalLanguage,
          ...rel.queryExamples.map(q => q.description),
        ].join(" | "),
      })),
    })),
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  console.log("=".repeat(60))
  console.log("  Service Relations Documentation Generator")
  console.log("=".repeat(60))
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (parse only)" : "GENERATE DOCS"}`)
  console.log(`Output: ${OUTPUT_DIR}`)
  console.log(`LLM: ${OPENROUTER_API_KEY ? "Available" : "Not configured (using templates)"}`)
  console.log("")

  // Find all model files
  console.log("Scanning src/modules/**/models/...")
  const modelFiles = findModelFiles()
  console.log(`Found ${modelFiles.length} model files`)
  console.log("")

  // Parse all model files
  console.log("Parsing model definitions...")
  const parsedModels: ParsedModel[] = []

  for (const filePath of modelFiles) {
    const fileName = path.basename(filePath, ".ts")
    log(`  Parsing: ${fileName}`)

    const parsed = parseModelFile(filePath)
    if (parsed) {
      parsedModels.push(parsed)
      log(`    ✓ ${parsed.modelName}: ${parsed.relations.length} relations`)
    }
  }

  console.log(`Found ${parsedModels.length} models with relations`)
  console.log("")

  if (DRY_RUN) {
    console.log("Parsed Models Summary:")
    console.log("-".repeat(60))
    for (const model of parsedModels) {
      console.log(`${model.moduleName}/${model.modelName}:`)
      for (const rel of model.relations) {
        const typeIcon = rel.type === "hasMany" ? "📚" : rel.type === "hasOne" ? "🔗" : "⬆️"
        console.log(`  ${typeIcon} ${rel.name}: ${rel.type} → ${rel.targetModel}`)
      }
      console.log("")
    }

    // Summary stats
    const totalRelations = parsedModels.reduce((sum, m) => sum + m.relations.length, 0)
    const hasManyCount = parsedModels.reduce((sum, m) =>
      sum + m.relations.filter(r => r.type === "hasMany").length, 0)
    const hasOneCount = parsedModels.reduce((sum, m) =>
      sum + m.relations.filter(r => r.type === "hasOne").length, 0)
    const belongsToCount = parsedModels.reduce((sum, m) =>
      sum + m.relations.filter(r => r.type === "belongsTo").length, 0)

    console.log("-".repeat(60))
    console.log(`Total: ${parsedModels.length} models, ${totalRelations} relations`)
    console.log(`  📚 hasMany: ${hasManyCount}`)
    console.log(`  🔗 hasOne: ${hasOneCount}`)
    console.log(`  ⬆️ belongsTo: ${belongsToCount}`)
    return
  }

  // Generate documentation
  console.log("Generating documentation...")
  const docs: RelationDocumentation[] = []
  const useLLM = !!OPENROUTER_API_KEY

  for (let i = 0; i < parsedModels.length; i++) {
    const model = parsedModels[i]
    console.log(`[${i + 1}/${parsedModels.length}] ${model.moduleName}/${model.modelName}`)

    let doc: RelationDocumentation | null

    if (useLLM) {
      doc = await generateDocWithLLM(model)
      if (doc) {
        console.log(`  ✓ Generated with LLM`)
      } else {
        console.log(`  ⚠ LLM failed, using template`)
        doc = generateDocWithoutLLM(model)
      }
      await sleep(2000)
    } else {
      doc = generateDocWithoutLLM(model)
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
  const mdPath = path.join(OUTPUT_DIR, "service-relations.md")
  fs.writeFileSync(mdPath, markdown)
  console.log(`\n✓ Markdown: ${mdPath}`)

  // Write JSON
  const json = generateJSON(docs)
  const jsonPath = path.join(OUTPUT_DIR, "service-relations.json")
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2))
  console.log(`✓ JSON: ${jsonPath}`)

  // Summary
  console.log("")
  console.log("=".repeat(60))
  console.log("  Summary")
  console.log("=".repeat(60))
  console.log(`Total models documented: ${docs.length}`)
  console.log("")
  const totalRelations = docs.reduce((sum, d) => sum + d.relations.length, 0)
  const hasManyCount = docs.reduce((sum, d) =>
    sum + d.relations.filter(r => r.type === "hasMany").length, 0)
  const hasOneCount = docs.reduce((sum, d) =>
    sum + d.relations.filter(r => r.type === "hasOne").length, 0)
  const belongsToCount = docs.reduce((sum, d) =>
    sum + d.relations.filter(r => r.type === "belongsTo").length, 0)

  console.log(`Relation types (${totalRelations} total):`)
  console.log(`  📚 hasMany: ${hasManyCount} (one-to-many)`)
  console.log(`  🔗 hasOne: ${hasOneCount} (one-to-one)`)
  console.log(`  ⬆️ belongsTo: ${belongsToCount} (many-to-one)`)
  console.log("")
  console.log("Remember: Use service.list/retrieve({ relations: [...] }) for these!")
  console.log("Use query.graph() only for module links (src/links/*.ts)")
}

// Execute
main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
