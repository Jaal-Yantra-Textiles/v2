/**
 * Entity Classifier Service
 *
 * Builds entity classification from the entity registry.
 * This allows the system to know at pre-execution time whether
 * an entity is a Core Medusa entity (HTTP API) or Custom module.
 */

import {
  getEntityConfig,
  CoreEntityConfig,
  CustomEntityConfig,
} from "../schema/entity-registry"
import { EntityClassification, ResponseExpectation } from "../tools/types"

/**
 * Classify an entity based on the entity registry
 *
 * @param entityName - The entity name to classify (e.g., "customer", "design")
 * @returns EntityClassification or null if entity not found
 */
export function classifyEntity(entityName: string): EntityClassification | null {
  const config = getEntityConfig(entityName)
  if (!config) {
    console.warn(`[EntityClassifier] Unknown entity: ${entityName}`)
    return null
  }

  if (config.is_core) {
    const coreConfig = config as CoreEntityConfig
    return {
      entityName,
      isCore: true,
      executionMethod: "http",
      apiPath: coreConfig.api_path,
      validRelations: coreConfig.relations || [],
    }
  } else {
    const customConfig = config as CustomEntityConfig
    return {
      entityName,
      isCore: false,
      executionMethod: "module",
      moduleKey: customConfig.module,
      modelName: customConfig.model_name,
      validRelations: customConfig.relations,
    }
  }
}

/**
 * Build response expectation based on entity type
 *
 * Core Medusa entities wrap arrays: { customers: [...] }
 * Custom modules typically return arrays directly or { data: [...] }
 *
 * @param entityName - The entity name
 * @param isCore - Whether it's a core Medusa entity
 * @returns ResponseExpectation configuration
 */
export function getResponseExpectation(
  entityName: string,
  isCore: boolean
): ResponseExpectation {
  // Medusa core entities wrap in plural form
  // e.g., { customers: [...] }, { orders: [...] }, { products: [...] }
  const wrapperKey = isCore ? getPluralForm(entityName) : undefined

  return {
    format: "array",
    wrapperKey,
    minimumFields: ["id"], // All entities should have an id
  }
}

/**
 * Get the plural form of an entity name (for Medusa response wrappers)
 *
 * @param entityName - Singular entity name
 * @returns Plural form
 */
function getPluralForm(entityName: string): string {
  // Handle special cases
  const irregulars: Record<string, string> = {
    category: "product_categories",
    inventory_item: "inventory_items",
    shipping_option: "shipping_options",
  }

  if (irregulars[entityName]) {
    return irregulars[entityName]
  }

  // Standard pluralization
  if (entityName.endsWith("y")) {
    return entityName.slice(0, -1) + "ies"
  }
  if (entityName.endsWith("s") || entityName.endsWith("x") || entityName.endsWith("ch")) {
    return entityName + "es"
  }
  return entityName + "s"
}

/**
 * Get classification summary for logging
 *
 * @param classification - The entity classification
 * @returns Human-readable classification string
 */
export function getClassificationSummary(classification: EntityClassification): string {
  if (classification.isCore) {
    return `CORE (HTTP → ${classification.apiPath})`
  }
  return `CUSTOM (module → ${classification.moduleKey})`
}

/**
 * Validate that requested relations are valid for an entity
 *
 * @param entityName - The entity name
 * @param requestedRelations - Relations requested by the query
 * @returns Object with valid relations and any invalid ones
 */
export function validateRelations(
  entityName: string,
  requestedRelations: string[] | undefined
): { valid: string[]; invalid: string[] } {
  if (!requestedRelations || requestedRelations.length === 0) {
    return { valid: [], invalid: [] }
  }

  const classification = classifyEntity(entityName)
  if (!classification) {
    return { valid: [], invalid: requestedRelations }
  }

  const valid: string[] = []
  const invalid: string[] = []

  for (const relation of requestedRelations) {
    if (classification.validRelations.includes(relation)) {
      valid.push(relation)
    } else {
      invalid.push(relation)
    }
  }

  if (invalid.length > 0) {
    console.warn(
      `[EntityClassifier] Invalid relations for ${entityName}: ${invalid.join(", ")}. ` +
        `Valid relations: ${classification.validRelations.join(", ")}`
    )
  }

  return { valid, invalid }
}

/**
 * Build step description for logging
 *
 * @param entity - Entity name
 * @param operation - Operation type
 * @param filters - Applied filters
 * @param classification - Entity classification
 * @returns Human-readable step description
 */
export function buildStepDescription(
  entity: string,
  operation: "list" | "retrieve",
  filters: Record<string, any>,
  classification: EntityClassification | null
): string {
  const filterDesc =
    Object.keys(filters).length > 0
      ? ` with filters: ${JSON.stringify(filters)}`
      : ""

  const typeDesc = classification
    ? ` (${classification.isCore ? "CORE" : "CUSTOM"})`
    : ""

  if (operation === "list") {
    return `List ${entity}s${typeDesc}${filterDesc}`
  }
  return `Retrieve ${entity}${typeDesc}${filterDesc}`
}

/**
 * Find dependencies between steps based on $N references
 *
 * @param filters - Filters that may contain $N references
 * @returns Array of step numbers this step depends on
 */
export function findDependencies(filters: Record<string, any>): number[] {
  const dependencies: number[] = []

  for (const value of Object.values(filters)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const match = value.match(/^\$(\d+)/)
      if (match) {
        const stepNum = parseInt(match[1], 10)
        if (!dependencies.includes(stepNum)) {
          dependencies.push(stepNum)
        }
      }
    }
  }

  return dependencies.sort((a, b) => a - b)
}
