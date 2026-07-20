/**
 * Shared request handler for the Partner MCP transport, mounted at
 * POST /partners/mcp (partner-authenticated via middlewares.ts).
 *
 * Thin wrapper over the shared mcp-core transport helpers: build a
 * partner-scoped server (auth captured from the request) and hand Medusa's
 * already-parsed JSON-RPC body to the stateless Streamable-HTTP transport.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handleMcpJsonRpc,
  mcpMethodNotAllowed,
  resolveLoopbackBaseUrl,
  envFlagDefaultTrue,
} from "../../../../lib/mcp-core"
import { buildPartnerMcpServer } from "./server"

/** Writes are on by default; a deployment can force read-only. */
export function isPartnerWriteEnabled(): boolean {
  return envFlagDefaultTrue("PARTNER_MCP_ENABLE_WRITE")
}

/**
 * Loopback origin for proxying to /partners/* on this same process. Derived
 * from the incoming request by default; override with PARTNER_MCP_LOOPBACK_URL.
 */
export function resolvePartnerBaseUrl(req: MedusaRequest): string {
  return resolveLoopbackBaseUrl(req, "PARTNER_MCP_LOOPBACK_URL")
}

export async function handlePartnerMcpRequest(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const server = buildPartnerMcpServer({
    baseUrl: resolvePartnerBaseUrl(req),
    bearer: req.get("authorization") || undefined,
    cookie: req.get("cookie") || undefined,
    enableWrite: isPartnerWriteEnabled(),
  })
  await handleMcpJsonRpc(req, res, server)
}

export function partnerMcpMethodNotAllowed(
  req: MedusaRequest,
  res: MedusaResponse
): void {
  mcpMethodNotAllowed(req, res)
}
