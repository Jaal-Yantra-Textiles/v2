/**
 * Model Parser Service
 *
 * Parses DML (Data Modeling Language) model files from src/modules to extract:
 * - Field names and types
 * - Searchable fields (.searchable())
 * - Enum values with exact options
 * - Relations (hasMany, belongsTo, hasOne)
 *
 * This provides rich context for the query planner about custom modules.
 */

import * as fs from "fs"
import * as path from "path"
import glob from "glob"
import { promisify } from "util"

const globAsync = promisify(glob)

/**
 * Parsed field information from a DML model
 */
export interface ParsedField {
  name: string
  type: "text" | "number" | "enum" | "boolean" | "dateTime" | "bigNumber" | "id" | "json" | "array"
  searchable: boolean
  nullable: boolean
  enumValues?: string[]
  defaultValue?: string
}

/**
 * Parsed relation from a DML model
 */
export interface ParsedRelation {
  name: string
  type: "hasMany" | "belongsTo" | "hasOne" | "manyToMany"
  targetModel: string
  mappedBy?: string
}

/**
 * Complete parsed model
 */
export interface ParsedModel {
  modelName: string
  tableName: string
  filePath: string
  fields: ParsedField[]
  relations: ParsedRelation[]
  searchableFields: string[]
  enumFields: Record<string, string[]>
}

/**
 * Cache of parsed models
 */
const modelCache: Map<string, ParsedModel> = new Map()
let initialized = false

/**
 * Parse all model files and cache results
 */
export async function parseAllModels(modulesPath: string): Promise<Map<string, ParsedModel>> {
  if (initialized && modelCache.size > 0) {
    return modelCache
  }

  const pattern = path.join(modulesPath, "**/models/*.ts").replace(/\\/g, "/")
  const modelFiles = await globAsync(pattern)

  console.log(`[ModelParser] Found ${modelFiles.length} model files`)

  for (const filePath of modelFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const models = parseModelFile(content, filePath)

      for (const model of models) {
        // Store by multiple keys for flexible lookup
        const keys = [
          model.modelName.toLowerCase(),
          model.tableName.toLowerCase(),
          model.tableName.replace(/_/g, "").toLowerCase(),
        ]

        for (const key of keys) {
          modelCache.set(key, model)
        }

        console.log(
          `[ModelParser] Parsed: ${model.modelName} ` +
            `(${model.searchableFields.length} searchable, ${model.relations.length} relations)`
        )
      }
    } catch (error) {
      console.warn(`[ModelParser] Failed to parse ${filePath}:`, error)
    }
  }

  initialized = true
  return modelCache
}

/**
 * Parse a single model file (regex-based for speed)
 */
function parseModelFile(content: string, filePath: string): ParsedModel[] {
  const models: ParsedModel[] = []

  // Match model.define("name", { ... }) - handles multiline
  const modelDefineRegex = /model\.define\s*\(\s*["'](\w+)["']\s*,\s*\{([\s\S]*?)\}\s*\)/g

  let match
  while ((match = modelDefineRegex.exec(content)) !== null) {
    const modelName = match[1]
    const fieldsBlock = match[2]

    const fields: ParsedField[] = []
    const relations: ParsedRelation[] = []

    // Parse individual fields - model.type() with optional chained modifiers
    const fieldPatterns = [
      // model.text(), model.number(), etc.
      /(\w+):\s*model\.(text|number|boolean|dateTime|bigNumber|id|json|array)\s*\(\s*\)([^,\n]*(?:\n[^,\n]*)*?)(?=,|\n\s*\w+:|$)/g,
      // model.enum([...])
      /(\w+):\s*model\.enum\s*\(\s*\[([^\]]+)\]\s*\)([^,\n]*(?:\n[^,\n]*)*?)(?=,|\n\s*\w+:|$)/g,
    ]

    // Parse basic fields
    const basicFieldRegex =
      /(\w+):\s*model\.(text|number|boolean|dateTime|bigNumber|id|json|array)\s*\(\s*[^)]*\)([^,]*)/g
    let fieldMatch
    while ((fieldMatch = basicFieldRegex.exec(fieldsBlock)) !== null) {
      const fieldName = fieldMatch[1]
      const fieldType = fieldMatch[2] as ParsedField["type"]
      const modifiers = fieldMatch[3] || ""

      // Skip if this is actually a relation
      if (["hasMany", "belongsTo", "hasOne", "manyToMany"].includes(fieldType)) {
        continue
      }

      const field: ParsedField = {
        name: fieldName,
        type: fieldType,
        searchable: modifiers.includes(".searchable()"),
        nullable: modifiers.includes(".nullable()"),
      }

      // Extract default value
      const defaultMatch = modifiers.match(/\.default\s*\(\s*["']?([^)"']+)["']?\s*\)/)
      if (defaultMatch) {
        field.defaultValue = defaultMatch[1]
      }

      fields.push(field)
    }

    // Parse enum fields
    const enumFieldRegex = /(\w+):\s*model\.enum\s*\(\s*\[([^\]]+)\]\s*\)([^,]*)/g
    while ((fieldMatch = enumFieldRegex.exec(fieldsBlock)) !== null) {
      const fieldName = fieldMatch[1]
      const enumValuesStr = fieldMatch[2]
      const modifiers = fieldMatch[3] || ""

      const enumValues = enumValuesStr
        .split(",")
        .map((v) => v.trim().replace(/["']/g, ""))
        .filter((v) => v.length > 0)

      const field: ParsedField = {
        name: fieldName,
        type: "enum",
        searchable: modifiers.includes(".searchable()"),
        nullable: modifiers.includes(".nullable()"),
        enumValues,
      }

      // Extract default value
      const defaultMatch = modifiers.match(/\.default\s*\(\s*["']([^"']+)["']\s*\)/)
      if (defaultMatch) {
        field.defaultValue = defaultMatch[1]
      }

      fields.push(field)
    }

    // Parse relations
    const relationRegex = /(\w+):\s*model\.(hasMany|belongsTo|hasOne|manyToMany)\s*\(\s*\(\)\s*=>\s*(\w+)/g
    let relMatch
    while ((relMatch = relationRegex.exec(fieldsBlock)) !== null) {
      const mappedByMatch = fieldsBlock
        .slice(relMatch.index)
        .match(/mappedBy:\s*["'](\w+)["']/)

      relations.push({
        name: relMatch[1],
        type: relMatch[2] as ParsedRelation["type"],
        targetModel: relMatch[3],
        mappedBy: mappedByMatch ? mappedByMatch[1] : undefined,
      })
    }

    models.push({
      modelName: modelName.charAt(0).toUpperCase() + modelName.slice(1),
      tableName: modelName,
      filePath,
      fields,
      relations,
      searchableFields: fields.filter((f) => f.searchable).map((f) => f.name),
      enumFields: Object.fromEntries(
        fields.filter((f) => f.enumValues).map((f) => [f.name, f.enumValues!])
      ),
    })
  }

  return models
}

/**
 * Get parsed model by name (supports various naming conventions)
 */
export function getParsedModel(modelName: string): ParsedModel | undefined {
  const normalized = modelName.toLowerCase().replace(/_/g, "")

  // Try exact match first
  if (modelCache.has(modelName.toLowerCase())) {
    return modelCache.get(modelName.toLowerCase())
  }

  // Try normalized match
  for (const [key, model] of modelCache.entries()) {
    if (key.replace(/_/g, "") === normalized) {
      return model
    }
  }

  return undefined
}

/**
 * Get all parsed models
 */
export function getAllParsedModels(): ParsedModel[] {
  const seen = new Set<string>()
  const models: ParsedModel[] = []

  for (const model of modelCache.values()) {
    if (!seen.has(model.tableName)) {
      seen.add(model.tableName)
      models.push(model)
    }
  }

  return models
}

/**
 * Build LLM-friendly documentation for a custom module
 */
export function buildModelDocForLLM(modelName: string): string | null {
  const model = getParsedModel(modelName)
  if (!model) return null

  const lines: string[] = [`### ${model.modelName} (Custom Module)`, `Table: ${model.tableName}`, ""]

  // Searchable fields
  if (model.searchableFields.length > 0) {
    lines.push(`**Searchable Fields** (use q filter):`)
    lines.push(`  ${model.searchableFields.join(", ")}`)
    lines.push("")
  }

  // Enum fields with values
  const enumEntries = Object.entries(model.enumFields)
  if (enumEntries.length > 0) {
    lines.push(`**Enum Fields** (filter by exact value):`)
    for (const [field, values] of enumEntries) {
      const displayValues = values.slice(0, 5).join(", ")
      const suffix = values.length > 5 ? ", ..." : ""
      lines.push(`  - ${field}: [${displayValues}${suffix}]`)
    }
    lines.push("")
  }

  // Relations
  if (model.relations.length > 0) {
    lines.push(`**Valid Relations**:`)
    for (const rel of model.relations) {
      lines.push(`  - ${rel.name} (${rel.type} → ${rel.targetModel})`)
    }
    lines.push("")
  }

  // Query patterns with correct method names
  const singularName = model.modelName
  const pluralName = getPluralName(model.modelName)

  lines.push(`**Query Patterns**:`)
  lines.push(`  - List: list${pluralName}(filters, config)`)
  lines.push(`  - Get by ID: retrieve${singularName}(id, config)`)
  lines.push(`  - Count: listAndCount${pluralName}(filters, config)`)

  return lines.join("\n")
}

/**
 * Get plural form of model name (handles common cases)
 */
function getPluralName(modelName: string): string {
  // Handle irregular plurals
  const irregulars: Record<string, string> = {
    Person: "People",
    Child: "Children",
    Man: "Men",
    Woman: "Women",
    Foot: "Feet",
    Tooth: "Teeth",
    Goose: "Geese",
    Mouse: "Mice",
    Ox: "Oxen",
    Category: "Categories",
    Policy: "Policies",
  }

  if (irregulars[modelName]) {
    return irregulars[modelName]
  }

  // Handle common suffix rules
  if (modelName.endsWith("y") && !/[aeiou]y$/i.test(modelName)) {
    return modelName.slice(0, -1) + "ies"
  }
  if (modelName.endsWith("s") || modelName.endsWith("x") || modelName.endsWith("ch") || modelName.endsWith("sh")) {
    return modelName + "es"
  }

  return modelName + "s"
}

/**
 * Build combined docs for multiple custom models
 */
export function buildAllCustomModelDocs(modelNames: string[]): string {
  const docs: string[] = ["## Custom Module Schema (from DML)", ""]

  for (const name of modelNames) {
    const doc = buildModelDocForLLM(name)
    if (doc) {
      docs.push(doc)
      docs.push("")
    }
  }

  return docs.length > 2 ? docs.join("\n") : ""
}

/**
 * Check if model cache is initialized
 */
export function isModelParserInitialized(): boolean {
  return initialized
}

/**
 * Clear model cache (for testing)
 */
export function clearModelCache(): void {
  modelCache.clear()
  initialized = false
}
