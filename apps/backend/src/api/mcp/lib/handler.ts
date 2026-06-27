/**
 * Shared request handler for the MCP transport, mounted at two paths:
 *   - /mcp        (open: zero-config, server injects the default key)
 *   - /store/mcp  (gated: Medusa's publishable-key middleware requires a key)
 *
 * Stateless Streamable HTTP: each POST is a self-contained JSON-RPC request, so
 * there is no session to track — ideal for a read-only catalog server. GET and
 * DELETE are not supported in stateless mode and return 405.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { buildStoreMcpServer } from "./server"

const PUBLISHABLE_HEADER = "x-publishable-api-key"

/**
 * Loopback origin for proxying to /store/* on this same process.
 *
 * Derived from the incoming request by default (`proto://host`), which is
 * correct everywhere: the integration test runner binds a random port, local
 * dev uses :9000, and prod uses the public host. Set STORE_MCP_LOOPBACK_URL to
 * force an internal address (e.g. http://localhost:9000) and skip a hop.
 */
function resolveBaseUrl(req: MedusaRequest): string {
  const override = process.env.STORE_MCP_LOOPBACK_URL
  if (override) {
    return override.replace(/\/$/, "")
  }
  const proto = (req.protocol || "http").split(",")[0].trim()
  const host = req.get("host")
  if (host) {
    return `${proto}://${host}`
  }
  const port = process.env.PORT || "9000"
  return `http://localhost:${port}`
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

  const server = buildStoreMcpServer({
    baseUrl: resolveBaseUrl(req),
    publishableKey,
    bearer,
    container: req.scope,
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

export function mcpMethodNotAllowed(
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
