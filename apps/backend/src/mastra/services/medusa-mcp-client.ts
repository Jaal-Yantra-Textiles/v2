/**
 * Medusa MCP Client
 *
 * Provides dynamic access to Medusa documentation via the official MCP server.
 * This replaces the static knowledge base with real-time queries to the MCP.
 *
 * Key features:
 * - Singleton MCPClient for efficient connection reuse
 * - Caching of MCP responses (30 min TTL)
 * - Graceful fallback to static knowledge if MCP unavailable
 * - Entity discovery for unknown entities
 *
 * Note: Uses dynamic import() for @mastra/mcp to handle ESM module
 *
 * Test Environment: MCP is automatically disabled in test environments
 * (NODE_ENV=test or TEST_TYPE is set) because @mastra/mcp has ESM-only
 * dependencies (exit-hook) that Jest cannot handle. All functions return
 * null/default values in test mode and the workflow uses fallback logic.
 */

// ============================================
// CONFIGURATION
// ============================================

const MEDUSA_MCP_URL = process.env.MEDUSA_MCP_URL || "https://docs.medusajs.com/mcp"
const CACHE_TTL_MS = (Number(process.env.MEDUSA_MCP_CACHE_TTL_MINUTES) || 30) * 60 * 1000

// Skip MCP in test environments (Jest can't handle ESM-only @mastra/mcp dependencies)
const IS_TEST_ENV = process.env.NODE_ENV === "test" || process.env.TEST_TYPE !== undefined
const DISABLE_MCP = process.env.DISABLE_MCP === "true" || IS_TEST_ENV

// ============================================
// MCP CLIENT SINGLETON
// ============================================

// Type for the Tool returned from MCP
interface MCPTool {
  id?: string
  name?: string
  execute: (args: any) => Promise<any>
  description?: string
}

// Type for the MCPClient - getTools() returns Record<string, Tool>
interface MCPClientInstance {
  getTools(): Promise<Record<string, MCPTool>>
  disconnect(): Promise<void>
}

let mcpClient: MCPClientInstance | null = null
let mcpInitPromise: Promise<MCPClientInstance> | null = null
let MCPClientClass: any = null

/**
 * Dynamically import the MCPClient class (ESM module)
 */
async function loadMCPClientClass(): Promise<any> {
  if (MCPClientClass) {
    return MCPClientClass
  }
  const mastraMcp = await import("@mastra/mcp")
  MCPClientClass = mastraMcp.MCPClient
  return MCPClientClass
}

/**
 * Get or create the singleton MCP client
 * Returns null in test environments to avoid ESM import issues
 */
async function getMCPClient(): Promise<MCPClientInstance | null> {
  // Skip MCP in test environments
  if (DISABLE_MCP) {
    return null
  }

  if (mcpClient) {
    return mcpClient
  }

  // Prevent multiple simultaneous initializations
  if (mcpInitPromise) {
    return mcpInitPromise
  }

  mcpInitPromise = (async () => {
    console.log("[MedusaMCPClient] Initializing connection to:", MEDUSA_MCP_URL)

    const ClientClass = await loadMCPClientClass()
    mcpClient = new ClientClass({
      servers: {
        medusa: {
          url: new URL(MEDUSA_MCP_URL),
        },
      },
    })

    return mcpClient!
  })()

  return mcpInitPromise
}

// ============================================
// CACHE
// ============================================

interface CacheEntry {
  data: string
  timestamp: number
}

const queryCache = new Map<string, CacheEntry>()

function getCachedResponse(key: string): string | null {
  const cached = queryCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }
  return null
}

function cacheResponse(key: string, data: string): void {
  queryCache.set(key, { data, timestamp: Date.now() })
}

// ============================================
// MCP QUERY FUNCTIONS
// ============================================

/**
 * Query the Medusa MCP server for documentation
 *
 * @param question - The question to ask about Medusa APIs
 * @returns The response text, or null if query failed
 */
export async function queryMedusaDocs(question: string): Promise<string | null> {
  // Skip in test environments
  if (DISABLE_MCP) {
    return null
  }

  // Check cache first
  const cacheKey = `query:${question.toLowerCase().trim()}`
  const cached = getCachedResponse(cacheKey)
  if (cached) {
    console.log("[MedusaMCPClient] Cache hit for:", question.slice(0, 50))
    return cached
  }

  try {
    const client = await getMCPClient()
    if (!client) {
      return null
    }
    const tools = await client.getTools()

    // Tools are returned as Record<string, Tool> with namespaced keys like "medusa_ask_medusa_question"
    // Find the ask_medusa_question tool by checking tool names
    const toolNames = Object.keys(tools)
    console.log("[MedusaMCPClient] Available tools:", toolNames.join(", "))

    // Look for ask_medusa_question tool (namespaced as medusa_ask_medusa_question)
    const askToolKey = toolNames.find(
      (name) => name.includes("ask_medusa_question") || name.includes("ask-medusa")
    )

    if (!askToolKey) {
      console.warn("[MedusaMCPClient] ask_medusa_question tool not found in MCP server")
      return null
    }

    const askTool = tools[askToolKey] as any
    console.log("[MedusaMCPClient] Querying MCP using tool:", askToolKey)
    console.log("[MedusaMCPClient] Tool structure:", Object.keys(askTool))

    // Execute the tool - Mastra tools wrap MCP tools
    // The execute function takes (context, options) where context is the input data
    // For MCP tools, we pass the input as { context: { question } }
    // Based on Mastra tool signature: execute({ context, ... }, options)
    const result = await askTool.execute({ context: { question }, toolCallId: "mcp-query" })

    // Extract text from result
    let responseText: string | null = null
    if (typeof result === "string") {
      responseText = result
    } else if (result?.content) {
      // MCP tools often return { content: [{ type: "text", text: "..." }] }
      if (Array.isArray(result.content)) {
        responseText = result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      } else if (typeof result.content === "string") {
        responseText = result.content
      }
    } else if (result?.text) {
      responseText = result.text
    }

    if (responseText) {
      cacheResponse(cacheKey, responseText)
      console.log("[MedusaMCPClient] Got response:", responseText.slice(0, 100), "...")
    }

    return responseText
  } catch (error) {
    console.error("[MedusaMCPClient] Query failed:", error)
    return null
  }
}

// ============================================
// ENTITY SCHEMA EXTRACTION
// ============================================

export interface MCPEntitySchema {
  entityName: string
  apiPath: string | null
  relations: string[]
  filters: string[]
  description: string | null
  rawResponse: string
}

/**
 * Get entity schema (filters, relations, API path) from Medusa MCP
 *
 * @param entityName - The entity name (e.g., "order", "refund_reason")
 * @returns Parsed schema or null if entity not found
 */
export async function getEntitySchemaFromMCP(
  entityName: string
): Promise<MCPEntitySchema | null> {
  // Check cache first
  const cacheKey = `schema:${entityName.toLowerCase()}`
  const cached = getCachedResponse(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as MCPEntitySchema
    } catch {
      // Invalid cache, continue to fetch
    }
  }

  // Query MCP for entity info
  const question = `What is the admin API endpoint for ${entityName} in Medusa v2? What are all available query parameters, filters, and expandable relations? List the endpoint path, filters, and relations clearly.`

  const response = await queryMedusaDocs(question)
  if (!response) {
    return null
  }

  // Parse the response to extract structured data
  const schema = parseMCPSchemaResponse(entityName, response)

  if (schema) {
    cacheResponse(cacheKey, JSON.stringify(schema))
  }

  return schema
}

/**
 * Parse an MCP response to extract entity schema information
 */
function parseMCPSchemaResponse(entityName: string, response: string): MCPEntitySchema | null {
  const lowerResponse = response.toLowerCase()

  // Check if entity was not found
  if (
    lowerResponse.includes("not found") ||
    lowerResponse.includes("does not exist") ||
    lowerResponse.includes("no documentation")
  ) {
    console.log(`[MedusaMCPClient] Entity ${entityName} not found in Medusa docs`)
    return null
  }

  // Extract API path
  const pathPatterns = [
    /(?:GET|POST|PUT|DELETE|PATCH)\s+\/admin\/([a-z-]+)/gi,
    /`\/admin\/([a-z-]+)`/gi,
    /\/admin\/([a-z-]+)/gi,
  ]

  let apiPath: string | null = null
  for (const pattern of pathPatterns) {
    const match = response.match(pattern)
    if (match) {
      // Clean up the path
      const cleanMatch = match[0].replace(/`/g, "").replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "")
      if (cleanMatch.startsWith("/admin/")) {
        apiPath = cleanMatch.split(/\s/)[0] // Take first path part
        break
      }
    }
  }

  // Extract relations
  const relations = extractListItems(response, [
    /relations?:?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
    /expandable\s+(?:relations?|fields?):?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
    /expand\s+(?:with)?:?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
  ])

  // Extract filters
  const filters = extractListItems(response, [
    /filters?:?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
    /query\s+parameters?:?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
    /(?:filter|query)\s+(?:by|using):?\s*\n?([\s\S]*?)(?:\n\n|\n(?:[A-Z]|$)|$)/i,
  ])

  // If we found an API path, it's a valid entity
  if (apiPath || relations.length > 0 || filters.length > 0) {
    return {
      entityName,
      apiPath,
      relations: [...new Set(relations)], // Deduplicate
      filters: [...new Set(filters)],
      description: extractDescription(response),
      rawResponse: response,
    }
  }

  // Try a simpler check - if the response contains useful content about the entity
  if (
    response.length > 100 &&
    (lowerResponse.includes(entityName.replace(/_/g, " ")) ||
      lowerResponse.includes(entityName.replace(/_/g, "-")))
  ) {
    return {
      entityName,
      apiPath: `/admin/${entityName.replace(/_/g, "-")}s`, // Best guess
      relations: relations,
      filters: filters,
      description: extractDescription(response),
      rawResponse: response,
    }
  }

  return null
}

/**
 * Extract list items from a section of text
 */
function extractListItems(text: string, patterns: RegExp[]): string[] {
  const items: string[] = []

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      const section = match[1]

      // Extract items from bullet points, numbered lists, or comma-separated
      const bulletItems = section.match(/[-*•]\s*`?([a-z_]+)`?/gi)
      if (bulletItems) {
        items.push(
          ...bulletItems.map((item) =>
            item
              .replace(/[-*•]\s*`?/g, "")
              .replace(/`/g, "")
              .trim()
          )
        )
      }

      // Also check for backtick-wrapped items
      const backtickItems = section.match(/`([a-z_]+)`/gi)
      if (backtickItems) {
        items.push(...backtickItems.map((item) => item.replace(/`/g, "").trim()))
      }

      // Comma-separated list
      const commaSplit = section.split(",").map((s) => s.trim())
      for (const item of commaSplit) {
        const cleanItem = item.replace(/[`\[\]]/g, "").trim()
        if (cleanItem && /^[a-z_]+$/.test(cleanItem)) {
          items.push(cleanItem)
        }
      }
    }
  }

  // Filter out common non-field words
  const excludeWords = new Set([
    "and",
    "or",
    "the",
    "a",
    "an",
    "with",
    "for",
    "by",
    "to",
    "in",
    "on",
    "at",
  ])

  return items.filter((item) => item.length > 1 && !excludeWords.has(item.toLowerCase()))
}

/**
 * Extract a description from the response
 */
function extractDescription(text: string): string | null {
  // Look for description patterns
  const patterns = [
    /^([^.\n]+\.)/m, // First sentence
    /description:?\s*([^\n]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1] && match[1].length < 300) {
      return match[1].trim()
    }
  }

  return null
}

// ============================================
// ENTITY DISCOVERY
// ============================================

export interface EntityDiscoveryResult {
  isValid: boolean
  entityType: "core" | "custom" | "unknown"
  schema: MCPEntitySchema | null
}

/**
 * Attempt to discover an unknown entity via Medusa MCP
 *
 * This is used when the LLM mentions an entity that's not in our registry.
 * We query the MCP to see if it's a valid Medusa entity.
 *
 * @param entityName - The entity name to discover
 * @returns Discovery result with schema if found
 */
export async function discoverEntityViaMCP(
  entityName: string
): Promise<EntityDiscoveryResult> {
  // Skip in test environments
  if (DISABLE_MCP) {
    return {
      isValid: false,
      entityType: "unknown",
      schema: null,
    }
  }

  console.log(`[MedusaMCPClient] Attempting to discover entity: ${entityName}`)

  const schema = await getEntitySchemaFromMCP(entityName)

  if (schema && schema.apiPath) {
    console.log(`[MedusaMCPClient] Discovered entity ${entityName}: ${schema.apiPath}`)
    return {
      isValid: true,
      entityType: "core",
      schema,
    }
  }

  console.log(`[MedusaMCPClient] Entity ${entityName} not found in Medusa docs`)
  return {
    isValid: false,
    entityType: "unknown",
    schema: null,
  }
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Clear the MCP response cache
 */
export function clearMCPClientCache(): void {
  queryCache.clear()
  console.log("[MedusaMCPClient] Cache cleared")
}

/**
 * Get cache statistics
 */
export function getMCPClientCacheStats(): {
  size: number
  keys: string[]
} {
  return {
    size: queryCache.size,
    keys: Array.from(queryCache.keys()),
  }
}

/**
 * Disconnect the MCP client
 */
export async function disconnectMCPClient(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.disconnect()
    } catch (error) {
      console.warn("[MedusaMCPClient] Disconnect error:", error)
    }
    mcpClient = null
    mcpInitPromise = null
    console.log("[MedusaMCPClient] Disconnected")
  }
}
