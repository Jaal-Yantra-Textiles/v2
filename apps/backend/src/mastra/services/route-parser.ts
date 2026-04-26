/**
 * Route Parser Service
 *
 * Parses API route files from src/api/admin to extract:
 * - HTTP methods (GET, POST, PUT, DELETE, PATCH)
 * - URL patterns with dynamic params
 * - Workflow triggers
 * - Query parameters from GET handlers
 *
 * Also parses validator files to extract:
 * - Zod schemas with field requirements
 * - Enum values
 * - Required vs optional fields
 */

import * as fs from "fs"
import * as path from "path"
import glob from "glob"
import { promisify } from "util"

const globAsync = promisify(glob)

/**
 * Parsed API route
 */
export interface ParsedRoute {
  path: string                          // e.g., "/admin/designs/[id]/send-to-partner"
  methods: ("GET" | "POST" | "PUT" | "DELETE" | "PATCH")[]
  module: string                        // e.g., "designs"
  action: string                        // e.g., "send-to-partner"
  hasWorkflow: boolean                  // Whether it triggers a workflow
  workflowName?: string                 // e.g., "sendDesignToPartnerWorkflow"
  params: string[]                      // Dynamic params like ["id"]
  queryParams?: ParsedQueryParam[]      // For GET requests
  bodySchema?: string                   // Validator type name
}

export interface ParsedQueryParam {
  name: string
  type: string
  required: boolean
  enumValues?: string[]
}

/**
 * Parsed validator schema
 */
export interface ParsedValidator {
  name: string                          // e.g., "designSchema"
  fields: ParsedValidatorField[]
  exports: string[]                     // Exported type names
}

export interface ParsedValidatorField {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object" | "enum" | "date" | "union"
  required: boolean
  enumValues?: string[]
  nested?: ParsedValidatorField[]
}

/**
 * Caches
 */
const routeCache: Map<string, ParsedRoute[]> = new Map()
const validatorCache: Map<string, ParsedValidator[]> = new Map()
let initialized = false

/**
 * Parse all API routes
 */
export async function parseAllRoutes(apiPath: string): Promise<Map<string, ParsedRoute[]>> {
  if (initialized && routeCache.size > 0) {
    return routeCache
  }

  const routePattern = path.join(apiPath, "**/route.ts").replace(/\\/g, "/")
  const routeFiles = await globAsync(routePattern)

  console.log(`[RouteParser] Found ${routeFiles.length} route files`)

  for (const filePath of routeFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const relativePath = path.relative(apiPath, filePath).replace(/\\/g, "/")
      const module = relativePath.split("/")[0]

      const routes = parseRouteFile(content, relativePath, module)

      if (!routeCache.has(module)) {
        routeCache.set(module, [])
      }
      routeCache.get(module)!.push(...routes)

      for (const route of routes) {
        const workflowIndicator = route.hasWorkflow ? ` (workflow: ${route.workflowName})` : ""
        console.log(`[RouteParser] Parsed: ${route.methods.join(",")} ${route.path}${workflowIndicator}`)
      }
    } catch (error) {
      console.warn(`[RouteParser] Failed to parse ${filePath}:`, error)
    }
  }

  // Also parse validators
  await parseAllValidators(apiPath)

  initialized = true
  return routeCache
}

/**
 * Parse validator files
 */
export async function parseAllValidators(apiPath: string): Promise<Map<string, ParsedValidator[]>> {
  const validatorPattern = path.join(apiPath, "**/validators.ts").replace(/\\/g, "/")
  const validatorFiles = await globAsync(validatorPattern)

  console.log(`[ValidatorParser] Found ${validatorFiles.length} validator files`)

  for (const filePath of validatorFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const relativePath = path.relative(apiPath, filePath).replace(/\\/g, "/")
      const module = relativePath.split("/")[0]

      const validators = parseValidatorFile(content)

      if (!validatorCache.has(module)) {
        validatorCache.set(module, [])
      }
      validatorCache.get(module)!.push(...validators)

      for (const v of validators) {
        console.log(`[ValidatorParser] Parsed: ${v.name} (${v.fields.length} fields)`)
      }
    } catch (error) {
      console.warn(`[ValidatorParser] Failed to parse ${filePath}:`, error)
    }
  }

  return validatorCache
}

/**
 * Parse a route file
 */
function parseRouteFile(content: string, relativePath: string, module: string): ParsedRoute[] {
  const routes: ParsedRoute[] = []

  // Build URL path from file path
  // designs/[id]/send-to-partner/route.ts → /admin/designs/[id]/send-to-partner
  const urlPath =
    "/admin/" +
    relativePath
      .replace(/\/route\.ts$/, "")
      .replace(/\\/g, "/")

  // Extract dynamic params
  const params = Array.from(urlPath.matchAll(/\[(\w+)\]/g)).map((m) => m[1])

  // Extract HTTP methods
  const methods: ParsedRoute["methods"] = []
  if (/export\s+(const|async\s+function)\s+GET\s*[=(]/m.test(content)) methods.push("GET")
  if (/export\s+(const|async\s+function)\s+POST\s*[=(]/m.test(content)) methods.push("POST")
  if (/export\s+(const|async\s+function)\s+PUT\s*[=(]/m.test(content)) methods.push("PUT")
  if (/export\s+(const|async\s+function)\s+DELETE\s*[=(]/m.test(content)) methods.push("DELETE")
  if (/export\s+(const|async\s+function)\s+PATCH\s*[=(]/m.test(content)) methods.push("PATCH")

  // Check for workflow usage
  const workflowMatch = content.match(/import\s+[^;]*?(\w+Workflow)[^;]*?from\s+["'][^"']*workflows/m)
  const hasWorkflow = !!workflowMatch
  const workflowName = workflowMatch?.[1]

  // Extract query params from GET handler
  let queryParams: ParsedQueryParam[] = []
  if (methods.includes("GET")) {
    queryParams = extractQueryParams(content)
  }

  // Determine action from path
  const pathParts = urlPath.split("/").filter(Boolean)
  let action = pathParts[pathParts.length - 1]
  // Handle dynamic segment at end
  if (action.startsWith("[") && action.endsWith("]")) {
    action = "detail"
  }
  action = action.replace(/-/g, "_")

  if (methods.length > 0) {
    routes.push({
      path: urlPath,
      methods,
      module,
      action,
      hasWorkflow,
      workflowName,
      params,
      queryParams: queryParams.length > 0 ? queryParams : undefined,
    })
  }

  return routes
}

/**
 * Extract query parameters from GET handler
 */
function extractQueryParams(content: string): ParsedQueryParam[] {
  const params: ParsedQueryParam[] = []

  // Match query type annotation: req.query: { offset?: number; status?: "X" | "Y"; ... }
  // Also handles multiline
  const queryTypeMatch = content.match(/query:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
  if (!queryTypeMatch) return params

  const queryBlock = queryTypeMatch[1]

  // Parse each param
  const paramRegex = /(\w+)\??:\s*([^;,\n]+)/g
  let match
  while ((match = paramRegex.exec(queryBlock)) !== null) {
    const name = match[1]
    let typeStr = match[2].trim()

    // Remove trailing semicolons or commas
    typeStr = typeStr.replace(/[;,]$/, "").trim()

    const required = !match[0].includes("?:")

    const param: ParsedQueryParam = {
      name,
      type: "string",
      required,
    }

    // Check for enum types (union of string literals)
    if (typeStr.includes("|") && typeStr.includes('"')) {
      const enumValues = typeStr
        .split("|")
        .map((v) => v.trim().replace(/["']/g, ""))
        .filter((v) => v.length > 0 && v !== "undefined")

      if (enumValues.length > 0) {
        param.type = "enum"
        param.enumValues = enumValues
      }
    } else if (typeStr === "number") {
      param.type = "number"
    } else if (typeStr.includes("[]")) {
      param.type = "array"
    } else if (typeStr === "boolean") {
      param.type = "boolean"
    }

    params.push(param)
  }

  return params
}

/**
 * Parse a validator file
 */
function parseValidatorFile(content: string): ParsedValidator[] {
  const validators: ParsedValidator[] = []

  // Match z.object definitions: const schemaName = z.object({ ... })
  const schemaRegex = /(?:export\s+)?const\s+(\w+(?:Schema)?)\s*=\s*z\.object\s*\(\s*\{/g

  let match
  while ((match = schemaRegex.exec(content)) !== null) {
    const name = match[1]
    const startIdx = match.index + match[0].length

    // Find matching closing brace (counts braces)
    let depth = 1
    let endIdx = startIdx
    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === "{") depth++
      else if (content[endIdx] === "}") depth--
      endIdx++
    }

    const schemaBlock = content.slice(startIdx, endIdx - 1)
    const fields = parseZodFields(schemaBlock)

    validators.push({
      name,
      fields,
      exports: [name],
    })
  }

  return validators
}

/**
 * Parse Zod fields from schema block
 */
function parseZodFields(block: string): ParsedValidatorField[] {
  const fields: ParsedValidatorField[] = []

  // Simple field pattern: name: z.type()...
  const fieldRegex = /(\w+):\s*z\.(string|number|boolean|array|object|enum|date|union)/g

  let match
  while ((match = fieldRegex.exec(block)) !== null) {
    const name = match[1]
    const type = match[2] as ParsedValidatorField["type"]

    // Check if optional (look ahead for .optional())
    const afterType = block.slice(match.index + match[0].length, match.index + match[0].length + 200)
    const required = !afterType.match(/^\s*\([^)]*\)\s*\.optional\s*\(/)

    // Extract enum values if present
    let enumValues: string[] | undefined
    if (type === "enum") {
      const enumMatch = block.slice(match.index).match(/z\.enum\s*\(\s*\[([^\]]+)\]/)
      if (enumMatch) {
        enumValues = enumMatch[1]
          .split(",")
          .map((v) => v.trim().replace(/["']/g, ""))
          .filter((v) => v.length > 0)
      }
    }

    fields.push({
      name,
      type,
      required,
      enumValues,
    })
  }

  return fields
}

/**
 * Get routes for a module
 */
export function getRoutesForModule(module: string): ParsedRoute[] {
  return routeCache.get(module) || []
}

/**
 * Get validators for a module
 */
export function getValidatorsForModule(module: string): ParsedValidator[] {
  return validatorCache.get(module) || []
}

/**
 * Get all modules with routes
 */
export function getAllRouteModules(): string[] {
  return Array.from(routeCache.keys())
}

/**
 * Build LLM-friendly documentation for a module's API
 */
export function buildAPIDocForLLM(module: string): string | null {
  const routes = getRoutesForModule(module)
  const validators = getValidatorsForModule(module)

  if (routes.length === 0) return null

  const lines: string[] = [`### ${module} API Endpoints`, ""]

  // Group routes by path (excluding dynamic params)
  const groupedRoutes = new Map<string, ParsedRoute[]>()
  for (const route of routes) {
    // Normalize path for grouping
    const basePath = route.path.replace(/\/\[\w+\]/g, "/[id]")
    if (!groupedRoutes.has(basePath)) {
      groupedRoutes.set(basePath, [])
    }
    groupedRoutes.get(basePath)!.push(route)
  }

  for (const route of routes) {
    lines.push(`**${route.methods.join("/")} ${route.path}**`)

    if (route.hasWorkflow) {
      lines.push(`  ⚡ Triggers workflow: ${route.workflowName}`)
    }

    if (route.queryParams && route.queryParams.length > 0) {
      lines.push(`  Query params:`)
      for (const p of route.queryParams) {
        const enumStr = p.enumValues
          ? ` (${p.enumValues.slice(0, 4).join("|")}${p.enumValues.length > 4 ? "|..." : ""})`
          : ""
        const requiredMark = p.required ? "*" : ""
        lines.push(`    - ${p.name}${requiredMark}: ${p.type}${enumStr}`)
      }
    }

    lines.push("")
  }

  // Add validator info
  if (validators.length > 0) {
    lines.push(`**Input Schemas:**`)
    for (const v of validators) {
      const required = v.fields.filter((f) => f.required).map((f) => f.name)
      const optional = v.fields.filter((f) => !f.required).map((f) => f.name)

      lines.push(`  ${v.name}:`)
      if (required.length > 0) {
        lines.push(`    Required: ${required.join(", ")}`)
      }
      if (optional.length > 0) {
        const displayOptional = optional.slice(0, 5).join(", ")
        const suffix = optional.length > 5 ? ", ..." : ""
        lines.push(`    Optional: ${displayOptional}${suffix}`)
      }

      // Show enum fields
      const enums = v.fields.filter((f) => f.enumValues)
      for (const e of enums) {
        const displayValues = e.enumValues!.slice(0, 5).join(", ")
        const suffix = e.enumValues!.length > 5 ? ", ..." : ""
        lines.push(`    ${e.name}: [${displayValues}${suffix}]`)
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Build complete API documentation for detected modules
 */
export function buildAllAPIDoc(modules: string[]): string {
  const docs: string[] = ["## API Endpoints (from codebase)", ""]

  for (const module of modules) {
    const doc = buildAPIDocForLLM(module)
    if (doc) {
      docs.push(doc)
    }
  }

  return docs.length > 2 ? docs.join("\n") : ""
}

/**
 * Find routes that trigger a specific workflow
 */
export function findRoutesForWorkflow(workflowName: string): ParsedRoute[] {
  const routes: ParsedRoute[] = []

  for (const moduleRoutes of routeCache.values()) {
    for (const route of moduleRoutes) {
      if (route.workflowName === workflowName) {
        routes.push(route)
      }
    }
  }

  return routes
}

/**
 * Map entity name to API module name
 */
export function entityToModuleName(entity: string): string | null {
  const mapping: Record<string, string> = {
    design: "designs",
    production_run: "production-runs",
    productionrun: "production-runs",
    task: "tasks",
    person: "persons",
    partner: "partners",
    raw_material: "raw-materials",
    rawmaterial: "raw-materials",
    inventory_order: "inventory-orders",
    inventoryorder: "inventory-orders",
    material_type: "material-types",
    materialtype: "material-types",
    customer: "customers",
    order: "orders",
    product: "products",
    store: "store",
  }

  const normalized = entity.toLowerCase().replace(/_/g, "")
  return mapping[normalized] || mapping[entity.toLowerCase()] || null
}

/**
 * Check if route parser is initialized
 */
export function isRouteParserInitialized(): boolean {
  return initialized
}

/**
 * Clear route cache (for testing)
 */
export function clearRouteCache(): void {
  routeCache.clear()
  validatorCache.clear()
  initialized = false
}
