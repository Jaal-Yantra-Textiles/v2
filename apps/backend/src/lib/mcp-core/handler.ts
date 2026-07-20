/**
 * Shared MCP core — HTTP transport helpers.
 *
 * Each surface's `POST /{surface}/mcp` route is stateless Streamable HTTP: one
 * self-contained JSON-RPC request per POST. `handleMcpJsonRpc` wires a freshly
 * built server (with the caller's auth captured in its context) to the
 * transport and hands Medusa's already-parsed body to it. `resolveLoopbackBaseUrl`
 * and `mcpMethodNotAllowed` are the shared bits every surface's handler reuses.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"

/** Parse a boolean env flag; defaults to `true` unless explicitly falsey. */
export function envFlagDefaultTrue(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase()
  if (v === "false" || v === "0" || v === "no") return false
  return true
}

/** Parse a boolean env flag; defaults to `false` unless explicitly truthy. */
export function envFlagDefaultFalse(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/**
 * Loopback origin for proxying to routes on this same process. Derived from the
 * incoming request by default (`proto://host`); override with the given env var
 * (e.g. http://localhost:9000) to skip a hop.
 */
export function resolveLoopbackBaseUrl(
  req: MedusaRequest,
  overrideEnvVar?: string
): string {
  const override = overrideEnvVar ? process.env[overrideEnvVar] : undefined
  if (override) return override.replace(/\/$/, "")
  const proto = (req.protocol || "http").split(",")[0].trim()
  const host = req.get("host")
  if (host) return `${proto}://${host}`
  const port = process.env.PORT || "9000"
  return `http://localhost:${port}`
}

/** Wire a built MCP server to a stateless Streamable-HTTP transport. */
export async function handleMcpJsonRpc(
  req: MedusaRequest,
  res: MedusaResponse,
  server: Server
): Promise<void> {
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
