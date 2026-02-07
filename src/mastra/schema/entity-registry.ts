/**
 * Entity Registry
 *
 * Static registry of all custom modules and core Medusa entities.
 * This registry enables the AI to understand what data is available
 * and how to fetch it with proper relations.
 *
 * IMPORTANT: Update this file when adding new modules or changing relations.
 */

// Custom module constants
import { DESIGN_MODULE } from "../../modules/designs"
import { PERSON_MODULE } from "../../modules/person"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { TASKS_MODULE } from "../../modules/tasks"
import { PARTNER_MODULE } from "../../modules/partner"

/**
 * Resolvable reference configuration
 * Defines how a filter field can be resolved from another entity
 */
export interface ResolvableRef {
  entity: string // The entity to query for resolution
  search_by: string[] // Fields that can be searched (e.g., ["q", "email"])
}

export interface CustomEntityConfig {
  description: string
  module: string
  is_core: false
  relations: string[]
  service_methods: string[]
  models?: string[]
  model_name: string // Primary model name for MedusaService method generation (e.g., "Design" -> listDesigns, retrieveDesign)
  keywords?: string[] // Additional keywords for entity detection
  resolvable_refs?: Record<string, ResolvableRef> // Fields that can be resolved from other entities
}

export interface CoreEntityConfig {
  description: string
  is_core: true
  api_path: string
  relations?: string[]
  keywords?: string[]
  resolvable_refs?: Record<string, ResolvableRef> // Fields that can be resolved from other entities
}

export type EntityConfig = CustomEntityConfig | CoreEntityConfig

/**
 * Registry of all entities available in the system
 *
 * For custom modules:
 * - module: The module constant string (used with container.resolve)
 * - relations: Available relations that can be fetched with the entity
 * - service_methods: Methods available on the service
 *
 * For core Medusa entities:
 * - api_path: The admin API path for fetching data
 * - relations: Common relations to include
 */
export const ENTITY_REGISTRY: Record<string, EntityConfig> = {
  // ============================================
  // CUSTOM MODULES
  // ============================================

  design: {
    description: "Product designs with specifications, colors, and size sets. Designs go through various stages from conceptual to commerce-ready.",
    module: DESIGN_MODULE,
    is_core: false,
    model_name: "Design",
    relations: ["specifications", "colors", "size_sets"],
    service_methods: ["list", "retrieve", "create", "update", "delete", "listDesigns", "retrieveDesign"],
    models: ["Design", "DesignSpecification", "DesignColor", "DesignSizeSet"],
    keywords: ["design", "product design", "specifications", "colors", "size sets", "moodboard"],
  },

  person: {
    description: "Contacts and people associated with the business - customers, suppliers, partners, etc.",
    module: PERSON_MODULE,
    is_core: false,
    model_name: "Person",
    relations: ["addresses", "contacts", "person_types"],
    service_methods: ["list", "retrieve", "create", "update", "delete", "listPeople", "retrievePerson"],
    models: ["Person"],
    keywords: ["person", "contact", "supplier", "vendor", "customer contact"],
  },

  inventory_order: {
    description: "Purchase orders for inventory/raw materials. Tracks orders placed with suppliers.",
    module: ORDER_INVENTORY_MODULE,
    is_core: false,
    model_name: "InventoryOrder",
    relations: ["order_lines", "supplier"],
    service_methods: ["list", "retrieve", "create", "update", "delete", "createInvWithLines"],
    models: ["InventoryOrder", "InventoryOrderLine"],
    keywords: ["inventory order", "purchase order", "po", "supplier order", "material order"],
    resolvable_refs: {
      partner_id: { entity: "partner", search_by: ["q", "name"] },
      supplier_id: { entity: "partner", search_by: ["q", "name"] },
    },
  },

  raw_material: {
    description: "Raw materials and fabrics used in production. Tracks inventory of materials.",
    module: RAW_MATERIAL_MODULE,
    is_core: false,
    model_name: "RawMaterial",
    relations: [],
    service_methods: ["list", "retrieve", "create", "update", "delete"],
    models: ["RawMaterial"],
    keywords: ["raw material", "material", "fabric", "inventory", "stock"],
  },

  production_run: {
    description: "Production workflow runs. Tracks manufacturing jobs from start to completion.",
    module: PRODUCTION_RUNS_MODULE,
    is_core: false,
    model_name: "ProductionRun",
    relations: ["tasks", "design"],
    service_methods: ["list", "retrieve", "create", "update", "delete"],
    models: ["ProductionRun"],
    keywords: ["production run", "manufacturing", "production job", "run"],
    resolvable_refs: {
      design_id: { entity: "design", search_by: ["q", "name"] },
    },
  },

  task: {
    description: "Tasks and to-dos associated with various workflows and production.",
    module: TASKS_MODULE,
    is_core: false,
    model_name: "Task",
    relations: ["production_run", "assignee"],
    service_methods: ["list", "retrieve", "create", "update", "delete"],
    models: ["Task"],
    keywords: ["task", "todo", "job", "assignment"],
    resolvable_refs: {
      production_run_id: { entity: "production_run", search_by: ["q"] },
      assignee_id: { entity: "person", search_by: ["q", "name", "email"] },
    },
  },

  partner: {
    description: "Business partners including suppliers, manufacturers, and collaborators.",
    module: PARTNER_MODULE,
    is_core: false,
    model_name: "Partner",
    relations: ["contacts", "addresses"],
    service_methods: ["list", "retrieve", "create", "update", "delete"],
    models: ["Partner"],
    keywords: ["partner", "supplier", "manufacturer", "vendor", "collaborator"],
  },

  // ============================================
  // CORE MEDUSA ENTITIES (use Admin API)
  // ============================================

  order: {
    description: "Customer orders and purchases. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/orders",
    // Note: In Medusa v2, some relations may have different names
    // items, customer, shipping_address, billing_address are valid
    // payments -> payment_collection, fulfillments -> fulfillment_collection
    relations: ["items", "customer", "shipping_address", "billing_address"],
    keywords: ["order", "purchase", "sale", "transaction"],
    resolvable_refs: {
      customer_id: { entity: "customer", search_by: ["q", "email"] },
    },
  },

  product: {
    description: "Products available for sale. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/products",
    relations: ["variants", "options", "images", "categories", "collections", "tags"],
    keywords: ["product", "item", "sku", "variant"],
    resolvable_refs: {
      collection_id: { entity: "collection", search_by: ["q"] },
      category_id: { entity: "category", search_by: ["q"] },
    },
  },

  customer: {
    description: "Registered customers who can make purchases. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/customers",
    relations: ["orders", "addresses", "groups"],
    keywords: ["customer", "buyer", "shopper", "user"],
  },

  inventory_item: {
    description: "Inventory items tracking stock levels. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/inventory-items",
    relations: ["location_levels"],
    keywords: ["inventory", "stock", "inventory item"],
  },

  store: {
    description: "Store configuration and settings including name, supported currencies, locales, default region and sales channel.",
    is_core: true,
    api_path: "/admin/stores",
    relations: ["supported_currencies", "supported_locales"],
    keywords: ["store", "store settings", "settings", "configuration", "currency", "currencies", "locale", "locales"],
  },

  region: {
    description: "Regions for shipping and taxes. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/regions",
    // Note: In Medusa v2, Region only has 'countries' as a direct relation
    // payment_providers is a module link (many-to-many)
    relations: ["countries"],
    keywords: ["region", "country", "location", "shipping zone"],
  },

  collection: {
    description: "Product collections for grouping products. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/collections",
    relations: ["products"],
    keywords: ["collection", "group", "category"],
  },

  category: {
    description: "Product categories for organization. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/product-categories",
    relations: ["products", "parent_category", "category_children"],
    keywords: ["category", "product category"],
  },

  shipping_option: {
    description: "Shipping options available for orders. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/shipping-options",
    relations: ["region", "provider"],
    keywords: ["shipping", "delivery", "shipping option"],
  },

  promotion: {
    description: "Promotions and discounts. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/promotions",
    relations: ["rules", "application_method"],
    keywords: ["promotion", "discount", "coupon", "sale"],
  },

  // Additional core entities commonly queried
  refund_reason: {
    description: "Refund reasons used when issuing refunds to customers. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/refund-reasons",
    relations: [],
    keywords: ["refund reason", "refund", "refund reasons"],
  },

  return_reason: {
    description: "Return reasons used when customers return items. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/return-reasons",
    relations: ["parent_return_reason"],
    keywords: ["return reason", "return", "return reasons"],
  },

  currency: {
    description: "Currencies available in the store. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/currencies",
    relations: [],
    keywords: ["currency", "currencies", "money"],
  },

  tax_rate: {
    description: "Tax rates for calculating taxes on items. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/tax-rates",
    relations: ["tax_region", "rules"],
    keywords: ["tax rate", "tax", "tax rates", "taxes"],
  },

  tax_region: {
    description: "Tax regions defining tax settings per country/province. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/tax-regions",
    relations: ["tax_rates", "country", "province"],
    keywords: ["tax region", "tax regions"],
  },

  sales_channel: {
    description: "Sales channels for selling products. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/sales-channels",
    relations: ["locations"],
    keywords: ["sales channel", "channel", "sales channels"],
  },

  stock_location: {
    description: "Stock locations for inventory management. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/stock-locations",
    relations: ["address", "fulfillment_sets"],
    keywords: ["stock location", "location", "warehouse"],
  },

  fulfillment_set: {
    description: "Fulfillment sets grouping delivery options. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/fulfillment-sets",
    relations: ["service_zones"],
    keywords: ["fulfillment set", "fulfillment"],
  },

  user: {
    description: "Admin users of the store. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/users",
    relations: [],
    keywords: ["user", "admin user", "users", "admin"],
  },

  invite: {
    description: "Invitations for new admin users. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/invites",
    relations: [],
    keywords: ["invite", "invitation", "invites"],
  },

  notification: {
    description: "Notifications sent to customers or admins. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/notifications",
    relations: [],
    keywords: ["notification", "notifications", "alert"],
  },

  api_key: {
    description: "API keys for authentication. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/api-keys",
    relations: [],
    keywords: ["api key", "api keys", "key", "secret key"],
  },

  price_list: {
    description: "Price lists for special pricing and sales. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/price-lists",
    relations: ["prices"],
    keywords: ["price list", "price lists", "pricing", "sale prices"],
  },

  draft_order: {
    description: "Draft orders created by admin before checkout. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/draft-orders",
    relations: ["items", "customer", "shipping_address"],
    keywords: ["draft order", "draft orders", "draft"],
  },

  reservation: {
    description: "Inventory reservations for line items. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/reservations",
    relations: ["inventory_item", "location"],
    keywords: ["reservation", "reservations", "reserved"],
  },

  claim: {
    description: "Claims for order issues and replacements. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/claims",
    relations: ["order", "claim_items", "additional_items"],
    keywords: ["claim", "claims"],
  },

  exchange: {
    description: "Exchanges for returning and replacing items. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/exchanges",
    relations: ["order", "return_items", "additional_items"],
    keywords: ["exchange", "exchanges"],
  },

  return: {
    description: "Returns for items being sent back. Core Medusa entity.",
    is_core: true,
    api_path: "/admin/returns",
    relations: ["order", "items"],
    keywords: ["return", "returns"],
  },
}

/**
 * Get all entity names
 */
export function getEntityNames(): string[] {
  return Object.keys(ENTITY_REGISTRY)
}

/**
 * Get all custom (non-core) entities
 */
export function getCustomEntities(): Array<[string, CustomEntityConfig]> {
  return Object.entries(ENTITY_REGISTRY).filter(
    ([, config]) => !config.is_core
  ) as Array<[string, CustomEntityConfig]>
}

/**
 * Get all core Medusa entities
 */
export function getCoreEntities(): Array<[string, CoreEntityConfig]> {
  return Object.entries(ENTITY_REGISTRY).filter(
    ([, config]) => config.is_core
  ) as Array<[string, CoreEntityConfig]>
}

/**
 * Detect entities mentioned in a message
 *
 * @param message - User message to analyze
 * @returns Array of entity names mentioned in the message
 */
export function detectEntities(message: string): string[] {
  if (!message) return []

  const messageLower = message.toLowerCase()
  const detectedEntities: string[] = []

  for (const [entityName, config] of Object.entries(ENTITY_REGISTRY)) {
    // Check entity name
    if (messageLower.includes(entityName.replace(/_/g, " "))) {
      detectedEntities.push(entityName)
      continue
    }

    // Check keywords
    const keywords = config.keywords || []
    for (const keyword of keywords) {
      if (messageLower.includes(keyword.toLowerCase())) {
        detectedEntities.push(entityName)
        break
      }
    }
  }

  // Deduplicate
  return [...new Set(detectedEntities)]
}

/**
 * Get entity configuration by name
 */
export function getEntityConfig(entityName: string): EntityConfig | undefined {
  return ENTITY_REGISTRY[entityName]
}

/**
 * Check if an entity is a custom module (not core Medusa)
 */
export function isCustomEntity(entityName: string): boolean {
  const config = ENTITY_REGISTRY[entityName]
  return config ? !config.is_core : false
}

/**
 * Get the module constant for a custom entity
 */
export function getModuleConstant(entityName: string): string | null {
  const config = ENTITY_REGISTRY[entityName]
  if (config && !config.is_core) {
    return (config as CustomEntityConfig).module
  }
  return null
}

/**
 * Get available relations for an entity
 */
export function getEntityRelations(entityName: string): string[] {
  const config = ENTITY_REGISTRY[entityName]
  if (!config) return []

  if (config.is_core) {
    return config.relations || []
  }

  return (config as CustomEntityConfig).relations
}

/**
 * Build a summary of all entities for LLM context
 */
export function buildEntitySummary(): string {
  const lines: string[] = ["# Available Entities\n"]

  lines.push("## Custom Modules\n")
  for (const [name, config] of getCustomEntities()) {
    lines.push(`### ${name}`)
    lines.push(`- Description: ${config.description}`)
    lines.push(`- Relations: ${config.relations.join(", ") || "none"}`)
    lines.push(`- Methods: ${config.service_methods.join(", ")}`)
    lines.push("")
  }

  lines.push("## Core Medusa Entities\n")
  for (const [name, config] of getCoreEntities()) {
    lines.push(`### ${name}`)
    lines.push(`- Description: ${config.description}`)
    lines.push(`- API: ${config.api_path}`)
    lines.push(`- Relations: ${config.relations?.join(", ") || "none"}`)
    lines.push("")
  }

  return lines.join("\n")
}
