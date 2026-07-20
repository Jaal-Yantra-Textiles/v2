/**
 * Shared request handler for the Store MCP transport, mounted at two paths:
 *   - /mcp        (open: zero-config, server injects the default key)
 *   - /store/mcp  (gated: Medusa's publishable-key middleware requires a key)
 *
 * Stateless Streamable HTTP: each POST is a self-contained JSON-RPC request, so
 * there is no session to track — ideal for a read-only catalog server. GET and
 * DELETE are not supported in stateless mode and return 405.
 *
 * Transport wiring (build server → hand parsed body to the stateless
 * Streamable-HTTP transport) is delegated to the shared mcp-core helpers; this
 * file owns only the store-specific bits: publishable-key resolution, the
 * STORE_MCP_ENABLE_WRITE gate and the dual-mount write-enable decision.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handleMcpJsonRpc,
  mcpMethodNotAllowed as coreMcpMethodNotAllowed,
  resolveLoopbackBaseUrl,
} from "../../../lib/mcp-core"
import { makeMcpLedgerSink } from "../../../lib/mcp-ledger"
import { buildStoreMcpServer } from "./server"

const PUBLISHABLE_HEADER = "x-publishable-api-key"

/**
 * Whether mutating cart/checkout tools are enabled. Off by default: the MCP
 * server is read-only unless STORE_MCP_ENABLE_WRITE is explicitly truthy.
 */
function isWriteEnabled(): boolean {
  const v = (process.env.STORE_MCP_ENABLE_WRITE || "").trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

export async function handleMcpRequest(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // Caller-supplied key (works on both mounts) wins; otherwise fall back to the
  // server's default public key (only reachable on the open /mcp mount, since
  // /store/mcp would have already 401'd without a key).
  const callerKey =
    req.get(PUBLISHABLE_HEADER) ||
    (req as any).publishable_key_context?.key ||
    undefined
  const publishableKey =
    callerKey || process.env.STORE_MCP_DEFAULT_PUBLISHABLE_KEY

  const bearer = req.get("authorization") || undefined

  // Writes are gated behind a *validated* publishable key. `publishable_key_context`
  // is only populated by Medusa's /store/* publishable-key middleware, so it is
  // present on the gated /store/mcp mount and absent on the open /mcp mount —
  // i.e. cart/checkout/PayU write tools require authenticating with a real key and
  // are never exposed anonymously on the zero-config endpoint. Reads stay open.
  const hasValidatedKey = !!(req as any).publishable_key_context
  const writesEnabledGlobally = isWriteEnabled()
  const enableWrite = writesEnabledGlobally && hasValidatedKey

  const server = buildStoreMcpServer({
    baseUrl: resolveLoopbackBaseUrl(req, "STORE_MCP_LOOPBACK_URL"),
    publishableKey,
    bearer,
    container: req.scope,
    enableWrite,
    // True on the open /mcp mount when writes exist but aren't reachable here —
    // lets the server tell agents to use the keyed /store/mcp mount instead.
    writesEnabledGlobally,
    observe: makeMcpLedgerSink(req.scope, { type: "storefront" }),
  })

  await handleMcpJsonRpc(req, res, server)
}

export function mcpMethodNotAllowed(
  req: MedusaRequest,
  res: MedusaResponse
): void {
  coreMcpMethodNotAllowed(req, res)
}
