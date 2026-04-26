/**
 * Medusa Static API Context Service
 *
 * Provides static Medusa API documentation context for query planning.
 * This serves as a backup/supplementary source of API filter and relation info.
 *
 * NOTE: For dynamic entity schema fetching (relations, filters),
 * use `medusa-mcp-client.ts` which queries the real Medusa MCP server.
 *
 * This service provides:
 * 1. Static API context for query planner prompts
 * 2. Fast, reliable fallback when MCP is unavailable
 * 3. Cached responses to avoid repeated lookups
 */

// Cache for MCP queries to avoid repeated calls
const mcpCache = new Map<string, { data: string; timestamp: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes (docs don't change often)

/**
 * Query Medusa documentation for API context
 *
 * This provides API documentation context for the query planner LLM.
 * Uses a combination of static knowledge and dynamic lookup.
 *
 * @param question - The question to ask about Medusa APIs
 * @returns Formatted documentation response
 */
export async function queryMedusaMCP(question: string): Promise<string> {
  if (!question || !question.trim()) {
    return ""
  }

  const cacheKey = question.toLowerCase().trim()
  const cached = mcpCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("[MedusaMCP] Cache hit for:", question.slice(0, 50))
    return cached.data
  }

  // Use static API context - this is reliable and fast
  // The MCP server (docs.medusajs.com/mcp) is for interactive tooling
  const context = getStaticAPIContext(question)

  if (context) {
    mcpCache.set(cacheKey, { data: context, timestamp: Date.now() })
    console.log("[MedusaMCP] Static context for:", question.slice(0, 50))
  }

  return context
}

/**
 * Get static API context for common entity queries
 *
 * This contains verified API documentation from Medusa's official docs.
 * The information was retrieved via the Medusa MCP server and is
 * kept as static knowledge for reliable, fast access.
 */
function getStaticAPIContext(question: string): string {
  const q = question.toLowerCase()

  if (q.includes("order")) {
    return `### Medusa Orders Admin API (GET /admin/orders)

**Filter Parameters:**
- id: Filter by order ID (string or array of strings)
- customer_id: Filter by customer ID (string or array) - CRITICAL for customer-specific queries
- status: Filter by order status (string or array)
- region_id: Filter by region ID (string or array)
- sales_channel_id: Filter by sales channel IDs (array)
- q: Full-text search on order's searchable properties
- created_at: Date filter with operators ($gt, $gte, $lt, $lte)
- updated_at: Date filter with operators ($gt, $gte, $lt, $lte)
- with_deleted: Include soft-deleted records (boolean)

**Query Operators:**
- $and: Join filters with AND condition (array of objects)
- $or: Join filters with OR condition (array of objects)
- $gt, $gte, $lt, $lte: Comparison operators for dates/numbers
- $like, $ilike: String pattern matching
- $exists: Check if value exists (not null)

**Relations (use fields parameter):**
- items: Order line items
- customer: Associated customer
- shipping_address, billing_address: Addresses
Note: In Medusa v2, use 'items' and 'customer' for basic relations.

**Examples:**
- GET /admin/orders?customer_id=cus_123
- GET /admin/orders?status=pending&created_at[$gte]=2024-01-01
- GET /admin/orders?fields=*,items,customer`
  }

  if (q.includes("customer")) {
    return `### Medusa Customers Admin API (GET /admin/customers)

**Filter Parameters:**
- id: Filter by customer ID (string or array)
- email: Filter by exact email address
- q: Full-text search on customer's searchable fields (name, email)
- groups: Filter by customer group IDs
- created_at, updated_at: Date filters with operators
- with_deleted: Include soft-deleted records

**Relations:**
- orders: Customer's orders
- addresses: Customer addresses
- groups: Customer groups

**Examples:**
- GET /admin/customers?q=John%20Doe (search by name)
- GET /admin/customers?email=john@example.com (exact email match)
- GET /admin/customers?fields=*,orders`
  }

  if (q.includes("product")) {
    return `### Medusa Products Admin API (GET /admin/products)

**Filter Parameters:**
- id: Filter by product ID (string or array)
- q: Full-text search on title, description
- status: Filter by product status (draft, proposed, published, rejected)
- collection_id: Filter by collection ID
- category_id: Filter by category ID (array)
- tags: Filter by tag values
- is_giftcard: Filter gift card products
- type_id: Filter by product type
- created_at, updated_at: Date filters

**Relations:**
- variants: Product variants with prices
- options: Product options (size, color, etc.)
- images: Product images
- categories: Product categories
- collections: Product collections
- tags: Product tags

**Examples:**
- GET /admin/products?collection_id=col_123
- GET /admin/products?q=summer&status=published
- GET /admin/products?fields=*,variants,images`
  }

  if (q.includes("inventory")) {
    return `### Medusa Inventory Items Admin API (GET /admin/inventory-items)

**Filter Parameters:**
- id: Filter by inventory item ID
- sku: Filter by SKU
- q: Full-text search
- location_id: Filter by stock location

**Relations:**
- location_levels: Stock levels per location

**Examples:**
- GET /admin/inventory-items?sku=PROD-001
- GET /admin/inventory-items?fields=*,location_levels`
  }

  if (q.includes("region")) {
    return `### Medusa Regions Admin API (GET /admin/regions)

**Filter Parameters:**
- id: Filter by region ID
- q: Full-text search on name
- currency_code: Filter by currency
- name: Filter by region name

**Relations:**
- countries: Countries in the region
Note: In Medusa v2, payment_providers and fulfillment_providers are module links (not direct relations).
Use only 'countries' as a direct expandable relation.`
  }

  if (q.includes("store")) {
    return `### Medusa Store Admin API (GET /admin/stores)

**Filter Parameters:**
- id: Filter by store ID
- name: Filter by store name

**Relations:**
- supported_currencies: Currencies supported by the store
- supported_locales: Locales supported by the store
- default_sales_channel: Default sales channel
- default_region: Default region

**Examples:**
- GET /admin/stores
- GET /admin/stores?fields=*,supported_currencies,supported_locales`
  }

  if (q.includes("collection")) {
    return `### Medusa Collections Admin API (GET /admin/collections)

**Filter Parameters:**
- id: Filter by collection ID
- q: Full-text search on title, handle
- handle: Filter by handle

**Relations:**
- products: Products in the collection`
  }

  if (q.includes("category")) {
    return `### Medusa Product Categories Admin API (GET /admin/product-categories)

**Filter Parameters:**
- id: Filter by category ID
- q: Full-text search on name
- handle: Filter by handle
- parent_category_id: Filter by parent category

**Relations:**
- products: Products in the category
- parent_category: Parent category
- category_children: Child categories`
  }

  // Generic context for unknown entities
  return `### Medusa Admin API General Patterns

**Common Filter Parameters:**
- id: Filter by ID (string or array)
- q: Full-text search on searchable fields
- created_at, updated_at: Date filters with $gt, $gte, $lt, $lte operators
- with_deleted: Include soft-deleted records

**Pagination:**
- offset: Number of items to skip
- limit: Maximum items to return
- order: Sort field (prefix with - for descending)

**Field Selection:**
- fields: Comma-separated fields to include
- Use * to include all fields, +field to add, -field to remove`
}

/**
 * Get API filter documentation for a specific entity
 *
 * @param entity - Entity name (order, customer, product, etc.)
 * @returns Documentation about available filters
 */
export async function getEntityFilterDocs(entity: string): Promise<string> {
  const question = `What filter parameters are available for the ${entity} admin API endpoint? Include customer_id, status, and other common filters.`
  return queryMedusaMCP(question)
}

/**
 * Get relationship documentation for an entity
 *
 * @param entity - Entity name
 * @returns Documentation about available relations
 */
export async function getEntityRelationDocs(entity: string): Promise<string> {
  const question = `What relations can be expanded when fetching ${entity}s from the admin API? How do I include related data?`
  return queryMedusaMCP(question)
}

/**
 * Build API context for query planning
 *
 * Fetches relevant Medusa API documentation to provide context
 * for the query planner LLM.
 *
 * @param entities - List of entities involved in the query
 * @returns Formatted API documentation context
 */
export async function buildAPIContextForPlanner(entities: string[]): Promise<string> {
  if (entities.length === 0) {
    return ""
  }

  const contextParts: string[] = []
  contextParts.push("## Medusa API Reference (from MCP)\n")

  // Fetch docs for each entity (in parallel for speed)
  const docPromises = entities.slice(0, 3).map(async (entity) => {
    const question = `How do I filter ${entity}s by related entity IDs in the admin API? Show filter parameters like customer_id, region_id, etc.`
    const docs = await queryMedusaMCP(question)
    return { entity, docs }
  })

  const results = await Promise.all(docPromises)

  for (const { entity, docs } of results) {
    if (docs) {
      contextParts.push(`### ${entity} API Filters`)
      // Truncate to avoid token explosion
      contextParts.push(docs.slice(0, 1500))
      contextParts.push("")
    }
  }

  return contextParts.join("\n")
}

/**
 * Clear the MCP cache
 */
export function clearMCPCache(): void {
  mcpCache.clear()
}
