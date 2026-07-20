/**
 * Builds the Store MCP server on the shared mcp-core (#1092).
 *
 * The store surface is the multi-tenant MCP: it keeps a thin surface-specific
 * server (rather than the core `buildMcpServer`) for two reasons unique to it:
 *  - It preserves the raw-JSON wire contract — clients parse the wrapped
 *    Store-route payload directly, not a `{ok,tool,data}` envelope.
 *  - Its DELETE (`remove_line_item`) is a normal cart op, so it opts out of the
 *    confirm/reason rails via `disableSensitiveRails`.
 * Everything else — path substitution, publishable-key scoping, the loopback
 * proxy, the write gate and observability — is delegated to the shared
 * `dispatchMcpTool`. The store-specific bits (per-call `store` → key resolution,
 * native store-discovery tools, dual-mount write copy) are supplied as
 * `McpContext` hooks:
 *  - `tenant`             — resolve a `store` arg to a publishable key.
 *  - `runNative`          — list_stores / get_storefront_key (container-backed).
 *  - `writeDisabledMessage` — the keyed-mount vs STORE_MCP_ENABLE_WRITE guidance.
 *
 * Tool input schemas stay plain JSON Schema (returned verbatim in tools/list),
 * so we avoid coupling to a specific zod version.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import {
  dispatchMcpTool,
  type McpContext,
  type McpToolDef,
  type McpToolEvent,
  type McpToolResult,
} from "../../../lib/mcp-core"
import { STORE_MCP_TOOLS } from "./registry"
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
  /** Optional observability sink (#844) — one event per tool call. */
  observe?: (evt: McpToolEvent) => void
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

// Shown on the keyed mount where the cart→checkout→order tools are live, so the
// agent runs the flow in the right order and follows up after the order lands.
const WRITE_FLOW_GUIDE =
  " Checkout flow (run in order): 1) detect_region for the shopper's country " +
  "(ask if unclear). 2) create_cart in that region; add_line_item for each " +
  "product. 3) set_customer_details — ALWAYS ask the shopper for their real " +
  "name, email and full shipping address first; never fabricate them. 4) " +
  "list_shipping_options → add_shipping_method. 5) Payment by region: INR → " +
  "create_payment_link (PayU card/UPI link); for UPI specifically, " +
  "payu_generate_upi_intent then generate_upi_qr to show a scannable QR. " +
  "Non-INR → create_stripe_payment_page. Each returns a URL/QR — hand it to the " +
  "shopper to pay. 6) Completion is asynchronous via webhook for BOTH PayU and " +
  "Stripe: after the shopper pays, POLL get_checkout_status every few seconds " +
  "until status='completed', then confirm the order to the shopper with its " +
  "order_id (and offer the order details). Don't assume payment succeeded — wait " +
  "for the poll. Only fall back to complete_cart / payu_complete_payment for a " +
  "manual or redirect-callback provider. If a step returns a `missing` list or " +
  "an error, ask the shopper for what's needed and retry."

const textResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
})

export function buildStoreMcpServer(ctx: StoreMcpContext): Server {
  // Writes are on for the deployment but not reachable on this (keyless) mount.
  const writesRequireKey = !!ctx.writesEnabledGlobally && !ctx.enableWrite
  const instructions =
    BASE_INSTRUCTIONS +
    (writesRequireKey ? WRITE_MOUNT_HINT : "") +
    (ctx.enableWrite ? WRITE_FLOW_GUIDE : "")

  // Native (container-backed) tools: store discovery + key resolution. Returns
  // the store's raw payload shape; the CallTool handler unwraps `data`.
  const runNative = async (
    native: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> => {
    if (!ctx.container) {
      return {
        ok: false,
        tool: native,
        error: "Store resolution unavailable (no container).",
      }
    }
    if (native === "list_stores") {
      const stores = await listStorefronts(ctx.container)
      return { ok: true, tool: native, data: { stores, count: stores.length } }
    }
    if (native === "get_storefront_key") {
      const store = String(args.store ?? "").trim()
      if (!store) {
        return { ok: false, tool: native, error: "Missing required parameter: store" }
      }
      const info = await resolveStorefront(ctx.container, store)
      if (!info) {
        return { ok: false, tool: native, error: `No storefront found for '${store}'.` }
      }
      return { ok: true, tool: native, data: info }
    }
    return { ok: false, tool: native, error: `Unhandled native tool: ${native}` }
  }

  const coreCtx: McpContext = {
    baseUrl: ctx.baseUrl,
    bearer: ctx.bearer,
    enableWrite: ctx.enableWrite,
    // The store's DELETE (remove_line_item) is a normal cart op — no rails.
    disableSensitiveRails: true,
    surface: "store",
    observe: ctx.observe,
    runNative,
    tenant: {
      defaultKey: ctx.publishableKey,
      resolveKey: async (storeArg: string) => {
        if (!ctx.container) return null
        const info = await resolveStorefront(ctx.container, storeArg)
        return info?.publishable_key ?? null
      },
      missingKeyMessage:
        "No publishable key. Pass a `store` argument (see list_stores), send an " +
        "'x-publishable-api-key' header, or configure STORE_MCP_DEFAULT_PUBLISHABLE_KEY " +
        "on the server.",
    },
    writeDisabledMessage: (name: string) =>
      writesRequireKey
        ? `Tool '${name}' is a write/checkout tool, available only on the keyed write mount. Reconnect to POST /store/mcp with an 'x-publishable-api-key' header.`
        : `Tool '${name}' is a write/checkout tool and is disabled on this server. Set STORE_MCP_ENABLE_WRITE=true to enable cart & payment tools.`,
  }

  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions,
  })

  // Write (cart/checkout) tools are only visible/callable when writes are on.
  const visibleTools = STORE_MCP_TOOLS.filter((t) => ctx.enableWrite || !t.write)

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const result = await dispatchMcpTool(
      coreCtx,
      STORE_MCP_TOOLS as unknown as McpToolDef[],
      req.params.name,
      args
    )
    if (!result.ok) {
      return textResult(result.error ?? JSON.stringify(result, null, 2), true)
    }
    // Preserve the store's raw-JSON wire contract: clients parse the wrapped
    // route payload directly, not the {ok,tool,data} envelope.
    const payload = result.data !== undefined ? result.data : result
    return textResult(JSON.stringify(payload, null, 2))
  })

  return server
}
