/**
 * Medusa Documentation Service
 *
 * Fetches documentation from Medusa docs via HTTP API.
 * This replaces the MCP approach for production use.
 *
 * Note: The MCP server at docs.medusajs.com/mcp is still available
 * for developer tooling (Claude desktop, etc.).
 */

export interface MedusaDocSearchResult {
  title: string
  content: string
  url: string
  section?: string
}

export interface MedusaDocsResponse {
  results: MedusaDocSearchResult[]
  query: string
}

// Cache for doc queries
const docsCache = new Map<string, { data: string; timestamp: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Query Medusa documentation using their search API
 *
 * This function attempts to use Medusa's documentation search endpoint.
 * If unavailable, it falls back to a curated set of common documentation.
 *
 * @param question - The question or search query
 * @returns Formatted documentation response
 */
export async function queryMedusaDocs(question: string): Promise<string> {
  if (!question || !question.trim()) {
    return ""
  }

  const cacheKey = question.toLowerCase().trim()
  const cached = docsCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    // Try the Medusa docs search API
    const response = await fetchMedusaSearch(question)
    const formatted = formatDocsResponse(response)

    docsCache.set(cacheKey, { data: formatted, timestamp: Date.now() })
    return formatted
  } catch (error) {
    console.warn("[MedusaDocs] Search API failed, using fallback:", error)

    // Fallback to static knowledge
    const fallback = getFallbackDocumentation(question)
    return fallback
  }
}

/**
 * Attempt to fetch from Medusa's documentation search API
 */
async function fetchMedusaSearch(query: string): Promise<MedusaDocsResponse> {
  // Medusa v2 uses Algolia for docs search
  // We'll try their public search endpoint
  const searchUrl = "https://docs.medusajs.com/api/search"

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`Medusa docs API error: ${response.status}`)
  }

  const data = await response.json()

  // Transform to our format
  return {
    query,
    results: (data.results || data.hits || []).slice(0, 5).map((hit: any) => ({
      title: hit.title || hit.hierarchy?.lvl1 || "Documentation",
      content: hit.content || hit._snippetResult?.content?.value || "",
      url: hit.url || `https://docs.medusajs.com${hit.path || ""}`,
      section: hit.hierarchy?.lvl2 || hit.section,
    })),
  }
}

/**
 * Format documentation response into readable markdown
 */
function formatDocsResponse(data: MedusaDocsResponse): string {
  if (!data.results || data.results.length === 0) {
    return `No documentation found for: "${data.query}"`
  }

  const sections = data.results.map((result) => {
    const parts: string[] = []

    parts.push(`### ${result.title}`)
    if (result.section) {
      parts.push(`*Section: ${result.section}*`)
    }
    parts.push("")
    parts.push(result.content.slice(0, 500))
    parts.push("")
    parts.push(`[Read more](${result.url})`)

    return parts.join("\n")
  })

  return sections.join("\n\n---\n\n")
}

/**
 * Fallback documentation for common Medusa concepts
 * Used when the search API is unavailable
 */
function getFallbackDocumentation(question: string): string {
  const q = question.toLowerCase()

  // Core API concepts
  if (q.includes("order") && (q.includes("api") || q.includes("how"))) {
    return `### Medusa Orders API

Orders in Medusa represent customer purchases. Key endpoints:

- \`GET /admin/orders\` - List orders with filtering and pagination
- \`GET /admin/orders/:id\` - Get order details with relations
- \`POST /admin/orders/:id/fulfillments\` - Create fulfillment
- \`POST /admin/orders/:id/capture\` - Capture payment
- \`POST /admin/orders/:id/refund\` - Create refund

Relations available: items, customer, shipping_address, billing_address, payments, fulfillments

[Read more](https://docs.medusajs.com/api/admin#orders)`
  }

  if (q.includes("product") && (q.includes("api") || q.includes("how"))) {
    return `### Medusa Products API

Products represent items for sale. Key endpoints:

- \`GET /admin/products\` - List products
- \`GET /admin/products/:id\` - Get product with variants
- \`POST /admin/products\` - Create product
- \`PUT /admin/products/:id\` - Update product
- \`DELETE /admin/products/:id\` - Delete product

Relations: variants, options, images, categories, collections

[Read more](https://docs.medusajs.com/api/admin#products)`
  }

  if (q.includes("customer") && (q.includes("api") || q.includes("how"))) {
    return `### Medusa Customers API

Customers are users who make purchases. Key endpoints:

- \`GET /admin/customers\` - List customers
- \`GET /admin/customers/:id\` - Get customer details
- \`POST /admin/customers\` - Create customer
- \`PUT /admin/customers/:id\` - Update customer

Relations: orders, addresses, groups

[Read more](https://docs.medusajs.com/api/admin#customers)`
  }

  if (q.includes("workflow") || q.includes("step")) {
    return `### Medusa Workflows

Workflows in Medusa are sequences of steps that perform operations:

\`\`\`typescript
import { createWorkflow, createStep } from "@medusajs/workflows-sdk"

const myStep = createStep({
  id: "my-step",
  execute: async ({ data }) => {
    // Step logic
    return { result: data }
  },
  compensate: async ({ data }) => {
    // Rollback logic
  }
})

const myWorkflow = createWorkflow("my-workflow")
  .then(myStep)
  .commit()
\`\`\`

[Read more](https://docs.medusajs.com/learn/fundamentals/workflows)`
  }

  if (q.includes("module") || q.includes("service")) {
    return `### Medusa Modules

Modules encapsulate business logic in Medusa:

\`\`\`typescript
import { Module } from "@medusajs/framework/utils"

export const MY_MODULE = "myModule"

const MyModule = Module(MY_MODULE, {
  service: MyService,
})

export default MyModule
\`\`\`

Services provide methods: list, retrieve, create, update, delete

[Read more](https://docs.medusajs.com/learn/fundamentals/modules)`
  }

  // Generic fallback
  return `### Medusa Documentation

For detailed information about "${question}", please refer to:

- [Medusa API Reference](https://docs.medusajs.com/api/admin)
- [Medusa Learn](https://docs.medusajs.com/learn)
- [Medusa Recipes](https://docs.medusajs.com/resources/recipes)

Note: The documentation search is temporarily unavailable. Try being more specific with your query.`
}

/**
 * Get documentation for a specific Medusa API endpoint
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API path (e.g., "/admin/orders")
 */
export async function getEndpointDocs(method: string, path: string): Promise<string> {
  const query = `${method} ${path} API endpoint`
  return queryMedusaDocs(query)
}

/**
 * Clear the documentation cache
 */
export function clearDocsCache(): void {
  docsCache.clear()
}
