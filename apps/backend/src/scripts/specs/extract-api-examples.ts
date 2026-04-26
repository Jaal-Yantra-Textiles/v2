/**
 * Extract API Examples from Integration Tests
 *
 * Parses integration test files to extract real API usage examples
 * including request bodies, endpoints, and response structures.
 *
 * Usage:
 *   import { extractAPIExamples } from './extract-api-examples'
 *   const examples = await extractAPIExamples('designs')
 */

import * as fs from "fs/promises"
import * as path from "path"
import glob from "glob"

export interface ExtractedAPIExample {
  description: string
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  endpoint: string
  requestBody?: string
  responseKey?: string
  sourceFile: string
  lineNumber: number
  category: "create" | "read" | "update" | "delete" | "link" | "action" | "other"
}

export interface CategorizedAPIExamples {
  create: ExtractedAPIExample[]
  read: ExtractedAPIExample[]
  update: ExtractedAPIExample[]
  delete: ExtractedAPIExample[]
  link: ExtractedAPIExample[]
  action: ExtractedAPIExample[]
}

/**
 * Extract API examples for a specific module from integration tests
 */
export async function extractAPIExamples(
  moduleName: string,
  testDir?: string
): Promise<CategorizedAPIExamples> {
  const integrationTestDir = testDir || path.join(process.cwd(), "integration-tests/http")
  const examples: ExtractedAPIExample[] = []

  // Generate search patterns for this module
  const modulePatterns = generateModulePatterns(moduleName)

  // Find matching test files
  const testFiles: string[] = []
  for (const pattern of modulePatterns) {
    try {
      const matches = glob.sync(path.join(integrationTestDir, pattern))
      if (Array.isArray(matches)) {
        testFiles.push(...matches)
      }
    } catch {
      // Pattern didn't match, skip
    }
  }

  // Deduplicate test files
  const uniqueTestFiles = [...new Set(testFiles)]

  for (const file of uniqueTestFiles) {
    try {
      const content = await fs.readFile(file, "utf-8")
      const fileExamples = extractExamplesFromFile(content, path.basename(file), moduleName)
      examples.push(...fileExamples)
    } catch (error) {
      console.warn(`  ⚠️  Could not read test file: ${file}`)
    }
  }

  // Deduplicate and categorize
  return categorizeExamples(deduplicateExamples(examples))
}

/**
 * Generate file patterns to search for a module
 */
function generateModulePatterns(moduleName: string): string[] {
  const normalized = moduleName.toLowerCase()
  const withHyphen = normalized.replace(/_/g, "-")
  const withUnderscore = normalized.replace(/-/g, "_")
  const singular = normalized.replace(/s$/, "")
  const plural = normalized.endsWith("s") ? normalized : normalized + "s"

  return [
    `${normalized}*.spec.ts`,
    `*${normalized}*.spec.ts`,
    `${withHyphen}*.spec.ts`,
    `*${withHyphen}*.spec.ts`,
    `${withUnderscore}*.spec.ts`,
    `*${withUnderscore}*.spec.ts`,
    `${singular}*.spec.ts`,
    `*${singular}*.spec.ts`,
    `${plural}*.spec.ts`,
    `*${plural}*.spec.ts`,
    `*-${normalized}-*.spec.ts`,
    `admin-${normalized}*.spec.ts`,
  ]
}

/**
 * Extract API examples from a single test file
 */
function extractExamplesFromFile(
  content: string,
  fileName: string,
  moduleName: string
): ExtractedAPIExample[] {
  const examples: ExtractedAPIExample[] = []
  const lines = content.split("\n")

  // Regex to find api.method() calls
  const apiCallRegex = /api\.(post|get|put|delete|patch)\s*\(\s*[`"']([^`"']+)[`"']/gi

  let match
  while ((match = apiCallRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase() as ExtractedAPIExample["method"]
    const endpoint = match[2]
    const lineNumber = content.slice(0, match.index).split("\n").length

    // Skip if endpoint doesn't seem related to the module
    const endpointLower = endpoint.toLowerCase()
    const modulePatterns = [
      moduleName.toLowerCase(),
      moduleName.toLowerCase().replace(/_/g, "-"),
      moduleName.toLowerCase().replace(/-/g, "_"),
      moduleName.toLowerCase().replace(/s$/, ""),
    ]

    const isRelevant = modulePatterns.some(
      (p) => endpointLower.includes(p) || endpointLower.includes(p + "s")
    )
    if (!isRelevant) continue

    // Extract request body for POST/PUT/PATCH
    let requestBody: string | undefined
    if (["POST", "PUT", "PATCH"].includes(method)) {
      requestBody = extractRequestBody(content, match.index)
    }

    // Extract response key from nearby expect statements
    const responseKey = extractResponseKey(content, match.index)

    // Determine category
    const category = categorizeEndpoint(method, endpoint)

    // Generate description
    const description = generateDescription(method, endpoint, category)

    examples.push({
      description,
      method,
      endpoint,
      requestBody,
      responseKey,
      sourceFile: fileName,
      lineNumber,
      category,
    })
  }

  return examples
}

/**
 * Extract request body from API call
 */
function extractRequestBody(content: string, startIndex: number): string | undefined {
  // Look for the content after the endpoint, before headers
  const afterEndpoint = content.slice(startIndex, startIndex + 2000)

  // Pattern 1: api.post("/endpoint", { ... }, headers)
  const inlineBodyMatch = afterEndpoint.match(
    /,\s*(\{[\s\S]*?\})\s*,\s*(?:headers|adminHeaders|partnerHeaders|\{)/
  )
  if (inlineBodyMatch) {
    return cleanRequestBody(inlineBodyMatch[1])
  }

  // Pattern 2: api.post("/endpoint", variableName, headers)
  const variableMatch = afterEndpoint.match(/,\s*(\w+)\s*,\s*(?:headers|adminHeaders|partnerHeaders)/)
  if (variableMatch) {
    const varName = variableMatch[1]
    // Try to find the variable definition earlier in the content
    const fullContent = content.slice(0, startIndex)
    const varDefMatch = fullContent.match(
      new RegExp(`(?:const|let)\\s+${varName}\\s*=\\s*(\\{[\\s\\S]*?\\})(?:\\s*;|\\s*$)`, "m")
    )
    if (varDefMatch) {
      return cleanRequestBody(varDefMatch[1])
    }
    return `/* See variable: ${varName} */`
  }

  return undefined
}

/**
 * Clean and format request body for readability
 */
function cleanRequestBody(body: string): string {
  // Remove excessive whitespace but keep structure
  return body
    .replace(/\s+/g, " ")
    .replace(/\{ /g, "{\n  ")
    .replace(/ \}/g, "\n}")
    .replace(/, /g, ",\n  ")
    .trim()
}

/**
 * Extract response key from nearby expect statements
 */
function extractResponseKey(content: string, index: number): string | undefined {
  const nearbyContent = content.slice(index, index + 1000)

  // Pattern: .data.entityName or response.data.entityName
  const dataKeyMatch = nearbyContent.match(/\.data\.(\w+)/)
  if (dataKeyMatch) {
    return dataKeyMatch[1]
  }

  // Pattern: expect(response.status).toBe(201)
  const statusMatch = nearbyContent.match(/\.status\)\.toBe\((\d+)\)/)
  if (statusMatch) {
    return `status: ${statusMatch[1]}`
  }

  return undefined
}

/**
 * Categorize endpoint based on method and path
 */
function categorizeEndpoint(
  method: string,
  endpoint: string
): ExtractedAPIExample["category"] {
  const endpointLower = endpoint.toLowerCase()

  // Link operations
  if (
    endpointLower.includes("/link") ||
    endpointLower.includes("/unlink") ||
    endpointLower.includes("/inventory") ||
    endpointLower.includes("/assign") ||
    endpointLower.includes("/attach")
  ) {
    return "link"
  }

  // Action operations (specific endpoints)
  if (
    endpointLower.includes("/approve") ||
    endpointLower.includes("/reject") ||
    endpointLower.includes("/send") ||
    endpointLower.includes("/accept") ||
    endpointLower.includes("/finish") ||
    endpointLower.includes("/complete") ||
    endpointLower.includes("/start") ||
    endpointLower.includes("/resume") ||
    endpointLower.includes("/export") ||
    endpointLower.includes("/checkout")
  ) {
    return "action"
  }

  // Standard CRUD
  switch (method) {
    case "GET":
      return "read"
    case "POST":
      return "create"
    case "PUT":
    case "PATCH":
      return "update"
    case "DELETE":
      return "delete"
    default:
      return "other"
  }
}

/**
 * Generate human-readable description
 */
function generateDescription(
  method: string,
  endpoint: string,
  category: ExtractedAPIExample["category"]
): string {
  // Extract entity name from endpoint
  const parts = endpoint.split("/").filter(Boolean)
  let entityName = "resource"

  for (const part of parts) {
    if (!part.startsWith(":") && !["admin", "store", "partners"].includes(part)) {
      entityName = part.replace(/-/g, " ")
      break
    }
  }

  // Generate description based on category
  switch (category) {
    case "create":
      return `Create new ${entityName}`
    case "read":
      return endpoint.includes(":") ? `Get ${entityName} by ID` : `List ${entityName}`
    case "update":
      return `Update ${entityName}`
    case "delete":
      return `Delete ${entityName}`
    case "link":
      return `Link ${entityName} relationship`
    case "action":
      // Extract action from endpoint
      const actionPart = parts[parts.length - 1]
      return `${actionPart.replace(/-/g, " ")} ${entityName}`
    default:
      return `${method} ${endpoint}`
  }
}

/**
 * Deduplicate examples by endpoint + method
 */
function deduplicateExamples(examples: ExtractedAPIExample[]): ExtractedAPIExample[] {
  const seen = new Map<string, ExtractedAPIExample>()

  for (const example of examples) {
    const key = `${example.method}:${example.endpoint}`
    const existing = seen.get(key)

    // Keep the example with more information (request body)
    if (!existing || (example.requestBody && !existing.requestBody)) {
      seen.set(key, example)
    }
  }

  return Array.from(seen.values())
}

/**
 * Categorize examples into groups
 */
function categorizeExamples(examples: ExtractedAPIExample[]): CategorizedAPIExamples {
  return {
    create: examples.filter((e) => e.category === "create"),
    read: examples.filter((e) => e.category === "read"),
    update: examples.filter((e) => e.category === "update"),
    delete: examples.filter((e) => e.category === "delete"),
    link: examples.filter((e) => e.category === "link"),
    action: examples.filter((e) => e.category === "action" || e.category === "other"),
  }
}

/**
 * Format examples for spec output
 */
export function formatExamplesForSpec(examples: CategorizedAPIExamples): object {
  const formatExample = (e: ExtractedAPIExample) => ({
    description: e.description,
    method: e.method,
    endpoint: e.endpoint,
    requestBody: e.requestBody,
    responseKey: e.responseKey,
    sourceFile: `${e.sourceFile}:${e.lineNumber}`,
  })

  return {
    create: examples.create.map(formatExample),
    read: examples.read.map(formatExample),
    update: examples.update.map(formatExample),
    delete: examples.delete.map(formatExample),
    link: examples.link.map(formatExample),
    action: examples.action.map(formatExample),
  }
}

// CLI mode
if (require.main === module) {
  const moduleName = process.argv[2]
  if (!moduleName) {
    console.error("Usage: npx tsx src/scripts/extract-api-examples.ts <module-name>")
    process.exit(1)
  }

  extractAPIExamples(moduleName).then((examples) => {
    console.log(`\n📋 API Examples for: ${moduleName}\n`)
    console.log("Create operations:", examples.create.length)
    console.log("Read operations:", examples.read.length)
    console.log("Update operations:", examples.update.length)
    console.log("Delete operations:", examples.delete.length)
    console.log("Link operations:", examples.link.length)
    console.log("Action operations:", examples.action.length)
    console.log("\n" + JSON.stringify(formatExamplesForSpec(examples), null, 2))
  })
}
