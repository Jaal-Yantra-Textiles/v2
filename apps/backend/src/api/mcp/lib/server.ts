/**
 * Builds the read-only Store MCP server.
 *
 * Uses the low-level `Server` + `setRequestHandler` API (rather than the
 * high-level `McpServer.registerTool`) so tool input schemas stay as plain
 * JSON Schema and we avoid coupling to a specific zod version. The bundled SDK
 * zod is nested under the package and never touches the project's zod v4.
 *
 * Every `tools/call` is dispatched to a registry entry and proxied to the
 * corresponding `/store/*` route.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { STORE_MCP_TOOLS } from "./registry"
import { callStoreRoute, type ProxyError } from "./proxy"

export type StoreMcpContext = {
  /** Backend origin for loopback calls, e.g. http://localhost:9000. */
  baseUrl: string
  /** Resolved publishable key (caller override or server default). */
  publishableKey?: string
  /** Optional forwarded customer auth header. */
  bearer?: string
}

const SERVER_INFO = { name: "jyt-store", version: "0.1.0" } as const

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
})

export function buildStoreMcpServer(ctx: StoreMcpContext): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: STORE_MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = STORE_MCP_TOOLS.find((t) => t.name === req.params.name)
    if (!def) {
      return textResult(`Unknown tool: ${req.params.name}`, true)
    }

    if (!ctx.publishableKey) {
      return textResult(
        "No publishable key available. Configure STORE_MCP_DEFAULT_PUBLISHABLE_KEY on the server, or send an 'x-publishable-api-key' header.",
        true
      )
    }

    const args = (req.params.arguments ?? {}) as Record<string, unknown>

    // Substitute path params (e.g. :id -> prod_123).
    let path = def.path
    for (const p of def.pathParams ?? []) {
      const value = args[p]
      if (value === undefined || value === null || value === "") {
        return textResult(`Missing required parameter: ${p}`, true)
      }
      path = path.replace(`:${p}`, encodeURIComponent(String(value)))
    }

    // Forward only the whitelisted query params.
    const query: Record<string, unknown> = {}
    for (const k of def.queryParams ?? []) {
      if (args[k] !== undefined && args[k] !== null) {
        query[k] = args[k]
      }
    }

    try {
      const data = await callStoreRoute({
        baseUrl: ctx.baseUrl,
        path,
        query,
        publishableKey: ctx.publishableKey,
        bearer: ctx.bearer,
      })
      return textResult(JSON.stringify(data, null, 2))
    } catch (e) {
      const err = e as ProxyError
      return textResult(
        `Error calling ${def.name} (${path}): ${err.message}`,
        true
      )
    }
  })

  return server
}
