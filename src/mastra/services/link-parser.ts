/**
 * Link Parser Service
 *
 * Parses defineLink() files from src/links to extract:
 * - Cross-module connections
 * - isList relationships
 * - Custom field names
 * - Extra columns in link tables
 *
 * This enables the query planner to understand how to fetch
 * linked data using Query.graph().
 */

import * as fs from "fs"
import * as path from "path"
import glob from "glob"
import { promisify } from "util"

const globAsync = promisify(glob)

/**
 * Parsed module link
 */
export interface ParsedLink {
  fileName: string
  sourceModule: string      // e.g., "InventoryModule", "PartnerModule"
  sourceLinkable: string    // e.g., "inventoryItem", "partner"
  targetModule: string      // e.g., "RawMaterialModule", "InventoryOrderModule"
  targetLinkable: string    // e.g., "rawMaterials", "inventoryOrders"
  isList: boolean           // Whether it's a one-to-many link
  fieldName?: string        // Custom field name (e.g., "inventory_orders")
  hasExtraColumns: boolean  // Whether link table has extra columns
  extraColumns?: string[]   // Names of extra columns
  entryPoint?: string       // Link table entity name for direct queries
}

/**
 * Caches
 */
const linkCache: ParsedLink[] = []
const linksByEntity: Map<string, ParsedLink[]> = new Map()
let initialized = false

/**
 * Normalize entity name from linkable (camelCase to snake_case, singular)
 */
function normalizeEntityName(linkable: string): string {
  // inventoryItem -> inventory_item
  // rawMaterials -> raw_material (singular)
  return linkable
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/s$/, "") // Remove trailing 's' for singular
}

/**
 * Parse all link files
 */
export async function parseAllLinks(linksPath: string): Promise<ParsedLink[]> {
  if (initialized && linkCache.length > 0) {
    return linkCache
  }

  const pattern = path.join(linksPath, "*.ts").replace(/\\/g, "/")
  const linkFiles = await globAsync(pattern)

  console.log(`[LinkParser] Found ${linkFiles.length} link files`)

  for (const filePath of linkFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const link = parseLinkFile(content, path.basename(filePath))

      if (link) {
        linkCache.push(link)

        // Index by both source and target entities
        const sourceEntity = normalizeEntityName(link.sourceLinkable)
        const targetEntity = normalizeEntityName(link.targetLinkable)

        if (!linksByEntity.has(sourceEntity)) {
          linksByEntity.set(sourceEntity, [])
        }
        linksByEntity.get(sourceEntity)!.push(link)

        if (!linksByEntity.has(targetEntity)) {
          linksByEntity.set(targetEntity, [])
        }
        linksByEntity.get(targetEntity)!.push(link)

        console.log(`[LinkParser] Parsed: ${link.fileName} (${sourceEntity} ↔ ${targetEntity})`)
      }
    } catch (error) {
      console.warn(`[LinkParser] Failed to parse ${filePath}:`, error)
    }
  }

  initialized = true
  return linkCache
}

/**
 * Parse a single link file
 */
function parseLinkFile(content: string, fileName: string): ParsedLink | null {
  // Match defineLink(...) call - handles multiline
  const defineLinkMatch = content.match(/defineLink\s*\(([\s\S]*?)\)\s*$/m)
  if (!defineLinkMatch) return null

  const linkContent = defineLinkMatch[1]

  // Extract source module and linkable
  // Pattern: ModuleName.linkable.entityName or { linkable: ModuleName.linkable.entityName, ... }
  const sourcePatterns = [
    /(\w+(?:Module)?)\s*\.linkable\.(\w+)/,
    /\{\s*linkable:\s*(\w+(?:Module)?)\s*\.linkable\.(\w+)/,
  ]

  let sourceModule: string | undefined
  let sourceLinkable: string | undefined

  for (const pattern of sourcePatterns) {
    const match = linkContent.match(pattern)
    if (match) {
      sourceModule = match[1]
      sourceLinkable = match[2]
      break
    }
  }

  if (!sourceModule || !sourceLinkable) return null

  // Find where the first argument ends (after comma)
  const firstCommaIdx = findMatchingComma(linkContent)
  if (firstCommaIdx === -1) return null

  const afterFirstArg = linkContent.slice(firstCommaIdx + 1)

  // Extract target module and linkable
  let targetModule: string | undefined
  let targetLinkable: string | undefined

  for (const pattern of sourcePatterns) {
    const match = afterFirstArg.match(pattern)
    if (match) {
      targetModule = match[1]
      targetLinkable = match[2]
      break
    }
  }

  if (!targetModule || !targetLinkable) return null

  // Check for isList on either side
  const isList = linkContent.includes("isList: true")

  // Check for custom field name
  const fieldMatch = linkContent.match(/field:\s*['"](\w+)['"]/)
  const fieldName = fieldMatch ? fieldMatch[1] : undefined

  // Check for extraColumns
  const hasExtraColumns = linkContent.includes("extraColumns")
  let extraColumns: string[] = []

  if (hasExtraColumns) {
    const columnsMatch = linkContent.match(/extraColumns:\s*\{([\s\S]*?)\}/)
    if (columnsMatch) {
      // Extract column names
      const columnNames = Array.from(columnsMatch[1].matchAll(/(\w+):\s*\{/g)).map((m) => m[1])
      extraColumns = columnNames
    }
  }

  // Derive entry point name for link table
  const sourceSnake = normalizeEntityName(sourceLinkable)
  const targetSnake = normalizeEntityName(targetLinkable)
  const entryPoint = hasExtraColumns ? `${sourceSnake}_${targetSnake}` : undefined

  return {
    fileName,
    sourceModule,
    sourceLinkable,
    targetModule,
    targetLinkable,
    isList,
    fieldName,
    hasExtraColumns,
    extraColumns: extraColumns.length > 0 ? extraColumns : undefined,
    entryPoint,
  }
}

/**
 * Find the comma that separates defineLink arguments
 * (handles nested braces)
 */
function findMatchingComma(content: string): number {
  let depth = 0
  let inString = false
  let stringChar = ""

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ""

    // Handle strings
    if ((char === '"' || char === "'") && prevChar !== "\\") {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
      }
      continue
    }

    if (inString) continue

    // Handle braces
    if (char === "{" || char === "(") {
      depth++
    } else if (char === "}" || char === ")") {
      depth--
    } else if (char === "," && depth === 0) {
      return i
    }
  }

  return -1
}

/**
 * Get all links for an entity
 */
export function getLinksForEntity(entityName: string): ParsedLink[] {
  const normalized = entityName.toLowerCase().replace(/_/g, "")

  // Try exact match first
  if (linksByEntity.has(entityName)) {
    return linksByEntity.get(entityName)!
  }

  // Try with underscores
  const withUnderscores = entityName.toLowerCase()
  if (linksByEntity.has(withUnderscores)) {
    return linksByEntity.get(withUnderscores)!
  }

  // Try normalized match
  for (const [key, links] of linksByEntity.entries()) {
    if (key.replace(/_/g, "") === normalized) {
      return links
    }
  }

  return []
}

/**
 * Get all parsed links
 */
export function getAllParsedLinks(): ParsedLink[] {
  return [...linkCache]
}

/**
 * Build LLM-friendly documentation about module links for an entity
 */
export function buildLinkDocForLLM(entityName: string): string | null {
  const links = getLinksForEntity(entityName)
  if (links.length === 0) return null

  const lines: string[] = [`**Module Links** (use Query.graph to fetch):`]

  for (const link of links) {
    const sourceEntity = normalizeEntityName(link.sourceLinkable)
    const targetEntity = normalizeEntityName(link.targetLinkable)

    // Determine which side is the "other" entity
    const normalizedInput = entityName.toLowerCase().replace(/_/g, "")
    const isSource =
      sourceEntity === entityName ||
      sourceEntity.replace(/_/g, "") === normalizedInput

    const otherEntity = isSource ? targetEntity : sourceEntity
    const otherLinkable = isSource ? link.targetLinkable : link.sourceLinkable

    // Determine field name for query
    const queryField = link.isList ? link.fieldName || otherLinkable : otherEntity

    const listIndicator = link.isList ? " (list)" : ""
    lines.push(`  - ${otherEntity}: fields=["*", "${queryField}.*"]${listIndicator}`)

    if (link.hasExtraColumns && link.extraColumns) {
      lines.push(`    Extra columns: ${link.extraColumns.join(", ")}`)
    }

    if (link.entryPoint) {
      lines.push(`    Link table: ${link.entryPoint}`)
    }
  }

  return lines.join("\n")
}

/**
 * Build complete link documentation for multiple entities
 */
export function buildAllLinkDocs(entityNames: string[]): string {
  const docs: string[] = []

  for (const entity of entityNames) {
    const linkDoc = buildLinkDocForLLM(entity)
    if (linkDoc) {
      docs.push(`### ${entity} Links`)
      docs.push(linkDoc)
      docs.push("")
    }
  }

  return docs.length > 0 ? "## Module Links (Cross-Module Relations)\n\n" + docs.join("\n") : ""
}

/**
 * Check if a link exists between two entities
 */
export function hasLinkBetween(entity1: string, entity2: string): boolean {
  const links = getLinksForEntity(entity1)
  const normalized2 = entity2.toLowerCase().replace(/_/g, "")

  return links.some((link) => {
    const source = normalizeEntityName(link.sourceLinkable).replace(/_/g, "")
    const target = normalizeEntityName(link.targetLinkable).replace(/_/g, "")
    return source === normalized2 || target === normalized2
  })
}

/**
 * Get the link between two entities
 */
export function getLinkBetween(entity1: string, entity2: string): ParsedLink | undefined {
  const links = getLinksForEntity(entity1)
  const normalized2 = entity2.toLowerCase().replace(/_/g, "")

  return links.find((link) => {
    const source = normalizeEntityName(link.sourceLinkable).replace(/_/g, "")
    const target = normalizeEntityName(link.targetLinkable).replace(/_/g, "")
    return source === normalized2 || target === normalized2
  })
}

/**
 * Check if link parser is initialized
 */
export function isLinkParserInitialized(): boolean {
  return initialized
}

/**
 * Clear link cache (for testing)
 */
export function clearLinkCache(): void {
  linkCache.length = 0
  linksByEntity.clear()
  initialized = false
}
