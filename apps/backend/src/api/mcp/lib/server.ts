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
  /**
   * When false (default), mutating cart/checkout tools are hidden from
   * tools/list and rejected by tools/call. Effective flag = writes enabled AND a
   * validated publishable key (only the /store/mcp mount).
   */
  enableWrite?: boolean
  /**
   * Whether STORE_MCP_ENABLE_WRITE is on at all (independent of the key). Used to
   * point agents on the open /mcp mount at the keyed /store/mcp write mount.
   */
  writesEnabledGlobally?: boolean
}

const SERVER_INFO = { name: "jyt-store", version: "0.1.0" } as const

const BASE_INSTRUCTIONS =
  "JYT Store MCP — browse the storefront catalog (products, categories, " +
  "collections, regions, currencies) and discover storefronts (list_stores). " +
  "Multi-tenant: pass a `store` arg (handle/domain) or an x-publishable-api-key " +
  "header to scope to a storefront."

// Shown on the open /mcp mount when write tools exist but require a key.
const WRITE_MOUNT_HINT =
  " To create or modify carts, run checkout, complete orders, or generate PayU " +
  "payment links, use the keyed write mount at POST /store/mcp with an " +
  "`x-publishable-api-key` header — those write tools are intentionally not " +
  "exposed on this open read-only endpoint."

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
})

export function buildStoreMcpServer(ctx: StoreMcpContext): Server {
  // Writes are on for the deployment but not reachable on this (keyless) mount.
  const writesRequireKey = !!ctx.writesEnabledGlobally && !ctx.enableWrite
  const instructions = BASE_INSTRUCTIONS + (writesRequireKey ? WRITE_MOUNT_HINT : "")

  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions,
  })

  // Write (cart/checkout) tools are only visible/callable when writes are on.
  const visibleTools = STORE_MCP_TOOLS.filter(
    (t) => ctx.enableWrite || !t.write
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools.map((t) => ({
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
    // Refuse mutating tools unless writes are enabled AND a key was presented.
    if (def.write && !ctx.enableWrite) {
      const msg = writesRequireKey
        ? `Tool '${def.name}' is a write/checkout tool, available only on the keyed write mount. Reconnect to POST /store/mcp with an 'x-publishable-api-key' header.`
        : `Tool '${def.name}' is a write/checkout tool and is disabled on this server. Set STORE_MCP_ENABLE_WRITE=true to enable cart & payment tools.`
      return textResult(msg, true)
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

    // Assemble the JSON body for write tools from the whitelisted body params.
    const body: Record<string, unknown> = {}
    for (const k of def.bodyParams ?? []) {
      if (args[k] !== undefined && args[k] !== null) {
        body[k] = args[k]
      }
    }

    try {
      const data = await callStoreRoute({
        baseUrl: ctx.baseUrl,
        method: def.method ?? "GET",
        path,
        query,
        body,
        publishableKey,
        bearer: ctx.bearer,
      })
      // Optional provider-specific normalization (e.g. payment next_action).
      const out = def.transform ? def.transform(data, args) : data
      return textResult(JSON.stringify(out, null, 2))
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
