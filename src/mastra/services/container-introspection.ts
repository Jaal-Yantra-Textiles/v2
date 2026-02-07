/**
 * Container Introspection Service
 *
 * Dynamically discovers all registered modules, entities, and their methods
 * by introspecting the Medusa container at runtime.
 *
 * This replaces static entity registries with dynamic discovery, ensuring
 * the AI always has accurate, up-to-date information about all available
 * entities - including new custom modules added without code changes.
 *
 * Based on the visual-flows/metadata approach.
 */

import { MedusaContainer } from "@medusajs/framework"
import { DmlEntity, camelToSnakeCase, pluralize } from "@medusajs/utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// ============================================
// TYPES
// ============================================

export interface DiscoveredModule {
  name: string           // Container registration key (e.g., "person", "design")
  entityName: string     // Queryable entity name (e.g., "people", "designs")
  type: "core" | "custom"
  description: string
  queryable: boolean
  fields?: FieldInfo[]
  serviceMethods?: string[]
}

export interface FieldInfo {
  name: string
  type: string
  filterable: boolean
}

export interface ContainerMetadata {
  modules: DiscoveredModule[]
  totalModules: number
  totalCustomModules: number
  totalCoreModules: number
  discoveredAt: number
}

// ============================================
// CACHE
// ============================================

let cachedMetadata: ContainerMetadata | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================
// CORE MEDUSA MODULES
// ============================================

const CORE_MODULES: Record<string, { entityName: string; description: string }> = {
  product: { entityName: "products", description: "Product catalog" },
  inventory: { entityName: "inventory_items", description: "Inventory items" },
  stock_location: { entityName: "stock_locations", description: "Stock locations" },
  pricing: { entityName: "prices", description: "Pricing" },
  promotion: { entityName: "promotions", description: "Promotions & discounts" },
  customer: { entityName: "customers", description: "Customer accounts" },
  sales_channel: { entityName: "sales_channels", description: "Sales channels" },
  cart: { entityName: "carts", description: "Shopping carts" },
  region: { entityName: "regions", description: "Regions/Markets" },
  api_key: { entityName: "api_keys", description: "API keys" },
  store: { entityName: "stores", description: "Stores" },
  tax: { entityName: "tax_rates", description: "Tax rates" },
  currency: { entityName: "currencies", description: "Currencies" },
  payment: { entityName: "payments", description: "Payments" },
  order: { entityName: "orders", description: "Customer orders" },
  auth: { entityName: "auth_identities", description: "Authentication" },
  user: { entityName: "users", description: "Admin users" },
  fulfillment: { entityName: "fulfillments", description: "Fulfillments" },
  notification: { entityName: "notifications", description: "Notifications" },
  file: { entityName: "files", description: "File storage" },
}

// Framework/internal services to skip
const SKIP_SERVICES = new Set([
  "__pg_connection__",
  "configModule",
  "featureFlagRouter",
  "logger",
  "remoteQuery",
  "query",
  "link",
  "remoteLink",
  "cache",
  "event_bus",
  "workflows",
  "locking",
  "caching",
  "index",
])

// ============================================
// INTROSPECTION FUNCTIONS
// ============================================

/**
 * Discover all modules from the Medusa container
 *
 * Introspects the Awilix container to find all registered services,
 * filters out framework internals, and categorizes as core/custom.
 */
export async function discoverModulesFromContainer(
  container: MedusaContainer
): Promise<ContainerMetadata> {
  // Check cache first
  if (cachedMetadata && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    console.log("[ContainerIntrospection] Cache hit, returning cached metadata")
    return cachedMetadata
  }

  console.log("[ContainerIntrospection] Discovering modules from container...")
  const modules: DiscoveredModule[] = []
  const registrations = (container as any).registrations || {}

  for (const key of Object.keys(registrations)) {
    // Skip framework services
    if (SKIP_SERVICES.has(key)) continue

    // Skip capitalized keys (these are model classes, not modules)
    if (/[A-Z]/.test(key)) continue

    // Only consider snake_case module names
    if (!/^[a-z0-9_]+$/.test(key)) continue

    // Check if it's a core Medusa module
    if (CORE_MODULES[key]) {
      modules.push({
        name: key,
        entityName: CORE_MODULES[key].entityName,
        type: "core",
        description: CORE_MODULES[key].description,
        queryable: true, // Core modules are always queryable
      })
      continue
    }

    // It's a custom module - try to get its entity names
    const entityNames = getModelEntityNamesFromModule(container, key)
    const primaryEntityName = entityNames[0] || getDefaultEntityName(key)

    // Try to get service methods
    const serviceMethods = getServiceMethodsFromModule(container, key)

    modules.push({
      name: key,
      entityName: primaryEntityName,
      type: "custom",
      description: `Custom module: ${key.replace(/_/g, " ")}`,
      queryable: true, // Assume queryable, will be verified when used
      serviceMethods,
    })

    // Also add sub-entities if the module has multiple models
    for (const subEntityName of entityNames.slice(1)) {
      modules.push({
        name: key,
        entityName: subEntityName,
        type: "custom",
        description: `Custom module: ${key.replace(/_/g, " ")} (${subEntityName})`,
        queryable: true,
      })
    }
  }

  const metadata: ContainerMetadata = {
    modules,
    totalModules: modules.length,
    totalCustomModules: modules.filter((m) => m.type === "custom").length,
    totalCoreModules: modules.filter((m) => m.type === "core").length,
    discoveredAt: Date.now(),
  }

  // Cache the result
  cachedMetadata = metadata
  cacheTimestamp = Date.now()

  console.log(
    `[ContainerIntrospection] Discovered ${metadata.totalModules} modules ` +
      `(${metadata.totalCoreModules} core, ${metadata.totalCustomModules} custom)`
  )

  return metadata
}

/**
 * Get entity names from a module's registered models
 *
 * Uses the MedusaServiceModelObjectsSymbol to access the model definitions
 * and extracts the entity names (pluralized snake_case).
 */
function getModelEntityNamesFromModule(container: MedusaContainer, moduleName: string): string[] {
  try {
    const service = container.resolve(moduleName) as any
    if (!service || !service.constructor) return []

    const modelObjectsSymbol = Symbol.for("MedusaServiceModelObjectsSymbol")
    const modelObjects =
      (service.constructor as any)[modelObjectsSymbol] || (service as any)[modelObjectsSymbol]

    if (!modelObjects || typeof modelObjects !== "object") return []

    const entityNames = Object.values(modelObjects)
      .map((config: any) => {
        if (DmlEntity.isDmlEntity(config) && typeof config.name === "string") {
          // Convert to Remote Query alias format: snake_case + pluralize
          const snake = camelToSnakeCase(config.name).toLowerCase()
          return pluralize(snake)
        }
        return undefined
      })
      .filter((n: any): n is string => typeof n === "string" && n.length > 0)

    return Array.from(new Set(entityNames))
  } catch {
    return []
  }
}

/**
 * Get service methods from a module
 *
 * Extracts method names from the resolved service that can be called.
 */
function getServiceMethodsFromModule(container: MedusaContainer, moduleName: string): string[] {
  try {
    const service = container.resolve(moduleName) as any
    if (!service) return []

    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
      .filter((name) => {
        // Skip constructor and private methods
        if (name === "constructor" || name.startsWith("_")) return false
        // Only include functions
        return typeof service[name] === "function"
      })

    return methods
  } catch {
    return []
  }
}

/**
 * Get default entity name from module name
 *
 * Converts module_name to pluralized form (e.g., "person" -> "people")
 */
function getDefaultEntityName(moduleName: string): string {
  // Known entity mappings for modules
  const entityMappings: Record<string, string> = {
    person: "people",
    person_type: "person_types",
    design: "designs",
    partner: "partners",
    tasks: "tasks",
    notes: "notes",
    agreements: "agreements",
    media: "media",
    feedback: "feedback",
    socials: "socials",
    social_provider: "social_providers",
    email_templates: "email_templates",
    raw_materials: "raw_materials",
    companies: "companies",
    websites: "websites",
    inventory_orders: "inventory_orders",
    internal_payments: "internal_payments",
    fullfilled_orders: "fullfilled_orders",
    custom_analytics: "custom_analytics",
    etsysync: "etsysync",
    external_stores: "external_stores",
    encryption: "encryption",
    visual_flows: "visual_flows",
    s3_custom: "s3_custom",
    production_runs: "production_runs",
  }

  if (entityMappings[moduleName]) {
    return entityMappings[moduleName]
  }

  // Default: pluralize the module name
  return pluralize(moduleName)
}

/**
 * Find a module by entity name or module name
 */
export function findModuleByName(
  metadata: ContainerMetadata,
  name: string
): DiscoveredModule | undefined {
  const normalizedName = name.toLowerCase().replace(/-/g, "_")

  // Try exact match on entity name
  let found = metadata.modules.find(
    (m) => m.entityName.toLowerCase() === normalizedName
  )
  if (found) return found

  // Try exact match on module name
  found = metadata.modules.find((m) => m.name.toLowerCase() === normalizedName)
  if (found) return found

  // Try singular form match
  const singular = normalizedName.replace(/s$/, "").replace(/ies$/, "y")
  found = metadata.modules.find(
    (m) =>
      m.name.toLowerCase() === singular ||
      m.entityName.toLowerCase().startsWith(singular)
  )

  return found
}

/**
 * Clear the metadata cache
 */
export function clearContainerCache(): void {
  cachedMetadata = null
  cacheTimestamp = 0
  console.log("[ContainerIntrospection] Cache cleared")
}

/**
 * Get a summary of all modules for LLM context
 */
export function buildModuleSummaryForLLM(metadata: ContainerMetadata): string {
  const lines: string[] = [
    "## Available Modules (Dynamically Discovered)",
    "",
    `Total: ${metadata.totalModules} modules (${metadata.totalCoreModules} core, ${metadata.totalCustomModules} custom)`,
    "",
  ]

  // Group by type
  const coreModules = metadata.modules.filter((m) => m.type === "core")
  const customModules = metadata.modules.filter((m) => m.type === "custom")

  if (coreModules.length > 0) {
    lines.push("### Core Medusa Modules")
    for (const mod of coreModules) {
      lines.push(`- ${mod.name}: ${mod.description} (entity: ${mod.entityName})`)
    }
    lines.push("")
  }

  if (customModules.length > 0) {
    lines.push("### Custom Modules")
    for (const mod of customModules) {
      let line = `- ${mod.name}: ${mod.description} (entity: ${mod.entityName})`
      if (mod.serviceMethods && mod.serviceMethods.length > 0) {
        const methods = mod.serviceMethods.slice(0, 5).join(", ")
        line += ` [methods: ${methods}${mod.serviceMethods.length > 5 ? "..." : ""}]`
      }
      lines.push(line)
    }
    lines.push("")
  }

  return lines.join("\n")
}
