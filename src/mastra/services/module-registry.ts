/**
 * Module Registry Service
 *
 * Parses the .medusa/types/modules-bindings.d.ts file to extract all available
 * modules and their service types. This information is used by the LLM to
 * generate correct service calls.
 */

import * as fs from "fs"
import * as path from "path"

export interface ModuleInfo {
  key: string // Container registration key (e.g., "media", "order", "design")
  serviceName: string // Suggested service variable name (e.g., "mediaService")
  type: "core" | "custom" // Core Medusa or custom module
  sourcePath?: string // For custom modules, the source file path
}

let cachedModules: ModuleInfo[] | null = null

/**
 * Parse the modules-bindings.d.ts file to extract module information
 */
export function parseModulesBindings(projectRoot: string = process.cwd()): ModuleInfo[] {
  if (cachedModules) {
    return cachedModules
  }

  const bindingsPath = path.join(projectRoot, ".medusa/types/modules-bindings.d.ts")

  if (!fs.existsSync(bindingsPath)) {
    console.warn("[ModuleRegistry] modules-bindings.d.ts not found at", bindingsPath)
    return getDefaultModules()
  }

  try {
    const content = fs.readFileSync(bindingsPath, "utf-8")
    const modules: ModuleInfo[] = []

    // Parse the ModuleImplementations interface
    // Format: 'module_key': ServiceType,
    const modulePattern = /'([^']+)':\s*(\w+|InstanceType<[^>]+>)/g
    let match: RegExpExecArray | null

    // Find the interface block
    const interfaceMatch = content.match(/interface ModuleImplementations \{([\s\S]*?)\}/)
    if (!interfaceMatch) {
      console.warn("[ModuleRegistry] ModuleImplementations interface not found")
      return getDefaultModules()
    }

    const interfaceContent = interfaceMatch[1]

    while ((match = modulePattern.exec(interfaceContent)) !== null) {
      const [, key, serviceType] = match

      // Determine if it's a core or custom module
      const isCore = serviceType.startsWith("I") && serviceType.includes("Service")

      // Extract source path for custom modules
      let sourcePath: string | undefined
      if (!isCore) {
        const importMatch = content.match(new RegExp(`import type \\w+ from '([^']+)'[\\s\\S]*?'${key}'`))
        if (importMatch) {
          sourcePath = importMatch[1]
        }
      }

      // Generate a suggested service variable name
      const serviceName = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) + "Service"

      modules.push({
        key,
        serviceName,
        type: isCore ? "core" : "custom",
        sourcePath,
      })
    }

    cachedModules = modules
    return modules
  } catch (error) {
    console.error("[ModuleRegistry] Error parsing modules-bindings.d.ts:", error)
    return getDefaultModules()
  }
}

/**
 * Get default modules if parsing fails
 */
function getDefaultModules(): ModuleInfo[] {
  return [
    // Core Medusa modules
    { key: "order", serviceName: "orderService", type: "core" },
    { key: "customer", serviceName: "customerService", type: "core" },
    { key: "product", serviceName: "productService", type: "core" },
    { key: "inventory", serviceName: "inventoryService", type: "core" },
    { key: "fulfillment", serviceName: "fulfillmentService", type: "core" },
    { key: "payment", serviceName: "paymentService", type: "core" },
    { key: "cart", serviceName: "cartService", type: "core" },
    { key: "region", serviceName: "regionService", type: "core" },
    { key: "store", serviceName: "storeService", type: "core" },
    { key: "user", serviceName: "userService", type: "core" },
    // Common custom modules
    { key: "design", serviceName: "designService", type: "custom" },
    { key: "partner", serviceName: "partnerService", type: "custom" },
    { key: "media", serviceName: "mediaService", type: "custom" },
    { key: "tasks", serviceName: "tasksService", type: "custom" },
    { key: "person", serviceName: "personService", type: "custom" },
  ]
}

/**
 * Get a formatted list of modules for the LLM prompt
 */
export function getModuleListForPrompt(projectRoot: string = process.cwd()): string {
  const modules = parseModulesBindings(projectRoot)

  const coreModules = modules.filter((m) => m.type === "core")
  const customModules = modules.filter((m) => m.type === "custom")

  const lines: string[] = [
    "AVAILABLE MODULES (use these exact service names):",
    "",
    "Core Medusa Modules:",
    ...coreModules.map((m) => `  - ${m.serviceName} (key: "${m.key}")`),
    "",
    "Custom Modules:",
    ...customModules.map((m) => `  - ${m.serviceName} (key: "${m.key}")`),
    "",
    "IMPORTANT: Always use the exact service name shown above, NOT variations like:",
    "  - mediaFileService ❌ -> use mediaService ✓",
    "  - orderModuleService ❌ -> use orderService ✓",
    "  - designsService ❌ -> use designService ✓",
  ]

  return lines.join("\n")
}

/**
 * Build a map from various service name variations to the correct module key
 * Used for runtime service resolution
 */
export function buildServiceKeyMap(projectRoot: string = process.cwd()): Map<string, string> {
  const modules = parseModulesBindings(projectRoot)
  const map = new Map<string, string>()

  for (const mod of modules) {
    // Add the direct key
    map.set(mod.key, mod.key)

    // Add common variations
    map.set(mod.serviceName.toLowerCase(), mod.key)
    map.set(mod.key.replace(/_/g, ""), mod.key)
    map.set(mod.key + "service", mod.key)
    map.set(mod.key + "_service", mod.key)

    // Add camelCase variations
    const camelCase = mod.key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    map.set(camelCase, mod.key)
    map.set(camelCase + "service", mod.key)
    map.set(camelCase.toLowerCase(), mod.key)

    // Handle plural forms
    if (!mod.key.endsWith("s")) {
      map.set(mod.key + "s", mod.key)
    }
  }

  return map
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Find the closest matching module key using fuzzy matching
 */
function findClosestMatch(
  input: string,
  candidates: string[],
  maxDistance: number = 3
): string | null {
  let bestMatch: string | null = null
  let bestDistance = Infinity

  const normalizedInput = input.toLowerCase()

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase()

    // Exact match
    if (normalizedInput === normalizedCandidate) {
      return candidate
    }

    // Check if input contains candidate or vice versa (substring match)
    if (normalizedInput.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedInput)) {
      const distance = Math.abs(normalizedInput.length - normalizedCandidate.length)
      if (distance < bestDistance) {
        bestDistance = distance
        bestMatch = candidate
      }
      continue
    }

    // Calculate edit distance
    const distance = levenshteinDistance(normalizedInput, normalizedCandidate)
    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance
      bestMatch = candidate
    }
  }

  return bestMatch
}

/**
 * Resolve a service name to the correct module key
 * Supports exact matching, pattern matching, and fuzzy matching for typos
 */
export function resolveServiceKey(
  serviceName: string,
  projectRoot: string = process.cwd()
): string | null {
  const keyMap = buildServiceKeyMap(projectRoot)
  const allKeys = Array.from(new Set(keyMap.values()))

  // Try direct lookup
  const normalized = serviceName.replace(/Service$/i, "").toLowerCase()

  // Try various exact patterns
  const patterns = [
    normalized,
    normalized.replace(/_/g, ""),
    serviceName.toLowerCase(),
  ]

  for (const pattern of patterns) {
    const key = keyMap.get(pattern)
    if (key) return key
  }

  // Try splitting camelCase (e.g., "mediaFile" -> try "media" first)
  const camelParts = serviceName
    .replace(/Service$/i, "")
    .split(/(?=[A-Z])/)
    .map((s) => s.toLowerCase())

  if (camelParts.length > 1) {
    // Try first part (e.g., "mediaFile" -> "media")
    const firstPart = camelParts[0]
    if (keyMap.has(firstPart)) {
      return keyMap.get(firstPart)!
    }

    // Try snake_case (e.g., "mediaFile" -> "media_file")
    const snakeCase = camelParts.join("_")
    if (keyMap.has(snakeCase)) {
      return keyMap.get(snakeCase)!
    }
  }

  // Fuzzy matching: find closest match for typos
  // e.g., "meida" -> "media", "desgn" -> "design", "partnr" -> "partner"
  const fuzzyMatch = findClosestMatch(normalized, allKeys, 2)
  if (fuzzyMatch) {
    console.log(`[ModuleRegistry] Fuzzy matched "${serviceName}" -> "${fuzzyMatch}"`)
    return fuzzyMatch
  }

  // Try fuzzy matching on camelCase first part
  if (camelParts.length > 0) {
    const fuzzyFirstPart = findClosestMatch(camelParts[0], allKeys, 2)
    if (fuzzyFirstPart) {
      console.log(`[ModuleRegistry] Fuzzy matched first part "${camelParts[0]}" -> "${fuzzyFirstPart}"`)
      return fuzzyFirstPart
    }
  }

  return null
}

// Clear cache (useful for testing or when files change)
export function clearModuleCache(): void {
  cachedModules = null
}
