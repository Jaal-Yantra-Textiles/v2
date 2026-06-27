/**
 * Builds the read-only Store MCP server.
 *
 * Uses the low-level `Server` + `setRequestHandler` API (rather than the
 * high-level `McpServer.registerTool`) so tool input schemas stay as plain
 * JSON Schema and we avoid coupling to a specific zod version.
 *
 * Two kinds of tools (see registry.ts):
 *  - proxy tools forward to a live /store/* route (loopback) with a resolved
 *    publishable key, inheriting pricing/tax/scoping/validators.
 *  - native tools run in-process against the container for store discovery and
 *    publishable-key resolution (list_stores, get_storefront_key).
 *
 * Proxy tools accept an optional `store` arg (handle/domain) that is resolved
 * server-side to that storefront's default publishable key — so agents work in
 * terms of store names, not raw pk_ tokens, across a multi-tenant deployment.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { STORE_MCP_TOOLS } from "./registry"
import { callStoreRoute, type ProxyError } from "./proxy"
import { listStorefronts, resolveStorefront } from "./store-resolver"

export type StoreMcpContext = {
  /** Backend origin for loopback calls, e.g. http://localhost:9000. */
  baseUrl: string
  /** Resolved publishable key (caller override or server default). */
  publishableKey?: string
  /** Optional forwarded customer auth header. */
  bearer?: string
  /** Medusa container (req.scope) for native store-resolution tools. */
  container?: any
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
    const args = (req.params.arguments ?? {}) as Record<string, unknown>

    // --- Native tools: store discovery / key resolution -------------------
    if (def.native) {
      if (!ctx.container) {
        return textResult("Store resolution unavailable (no container).", true)
      }
      try {
        if (def.native === "list_stores") {
          const stores = await listStorefronts(ctx.container)
          return textResult(
            JSON.stringify({ stores, count: stores.length }, null, 2)
          )
        }
        if (def.native === "get_storefront_key") {
          const store = String(args.store ?? "").trim()
          if (!store) {
            return textResult("Missing required parameter: store", true)
          }
          const info = await resolveStorefront(ctx.container, store)
          if (!info) {
            return textResult(`No storefront found for '${store}'.`, true)
          }
          return textResult(JSON.stringify(info, null, 2))
        }
      } catch (e) {
        return textResult(`Error in ${def.name}: ${(e as Error).message}`, true)
      }
      return textResult(`Unhandled native tool: ${def.native}`, true)
    }

    // --- Proxy tools: resolve the effective publishable key ---------------
    // A `store` arg (handle/domain) wins; otherwise the caller/default key.
    let publishableKey = ctx.publishableKey
    const storeArg = typeof args.store === "string" ? args.store.trim() : ""
    if (storeArg) {
      if (!ctx.container) {
        return textResult("Cannot resolve `store` (no container).", true)
      }
      const info = await resolveStorefront(ctx.container, storeArg)
      if (!info?.publishable_key) {
        return textResult(
          `No storefront / publishable key found for '${storeArg}'. Use list_stores to discover valid stores.`,
          true
        )
      }
      publishableKey = info.publishable_key
    }
    if (!publishableKey) {
      return textResult(
        "No publishable key. Pass a `store` argument (see list_stores), send an 'x-publishable-api-key' header, or configure STORE_MCP_DEFAULT_PUBLISHABLE_KEY on the server.",
        true
      )
    }

    // Substitute path params (e.g. :id -> prod_123).
    let path = def.path as string
    for (const p of def.pathParams ?? []) {
      const value = args[p]
      if (value === undefined || value === null || value === "") {
        return textResult(`Missing required parameter: ${p}`, true)
      }
      path = path.replace(`:${p}`, encodeURIComponent(String(value)))
    }

    // Forward only the whitelisted query params (`store` is consumed above,
    // never forwarded to the store route).
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
        publishableKey,
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
