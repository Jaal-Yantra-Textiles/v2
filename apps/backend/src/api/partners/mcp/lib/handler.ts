/**
 * Shared request handler for the Partner MCP transport, mounted at
 * POST /partners/mcp (partner-authenticated via middlewares.ts).
 *
 * Stateless Streamable HTTP: each POST is a self-contained JSON-RPC request.
 * The calling partner's auth (JWT bearer and/or session cookie) is captured
 * here and forwarded on every loopback proxy call, so the wrapped `/partners/*`
 * routes authenticate and scope to that partner.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { buildPartnerMcpServer } from "./server"

/** Writes are on by default; a deployment can force read-only. */
export function isPartnerWriteEnabled(): boolean {
  const v = (process.env.PARTNER_MCP_ENABLE_WRITE || "").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "no") return false
  return true
}

/**
 * Loopback origin for proxying to /partners/* on this same process. Derived
 * from the incoming request by default (`proto://host`); override with
 * PARTNER_MCP_LOOPBACK_URL (e.g. http://localhost:9000) to skip a hop.
 */
export function resolvePartnerBaseUrl(req: MedusaRequest): string {
  const override = process.env.PARTNER_MCP_LOOPBACK_URL
  if (override) return override.replace(/\/$/, "")
  const proto = (req.protocol || "http").split(",")[0].trim()
  const host = req.get("host")
  if (host) return `${proto}://${host}`
  const port = process.env.PORT || "9000"
  return `http://localhost:${port}`
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: each POST is self-contained
    enableJsonResponse: true, // return a plain JSON-RPC body, not an SSE stream
  })

  res.on("close", () => {
    transport.close()
    server.close()
  })

  await server.connect(transport)
  // Medusa's body parser has already consumed the stream, so hand the parsed
  // body to the transport explicitly.
  await transport.handleRequest(req as any, res as any, (req as any).body)
}

export function partnerMcpMethodNotAllowed(
  _req: MedusaRequest,
  res: MedusaResponse
): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This MCP endpoint is stateless; use POST.",
    },
    id: null,
  })
}
