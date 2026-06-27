/**
 * POST /store/mcp — same MCP server, under the gated store namespace.
 *
 * Medusa's publishable-key middleware runs first here, so this mount REQUIRES a
 * valid `x-publishable-api-key` header (no zero-config). It exists for callers
 * who prefer the store-namespace path or need partner-scoped access via their
 * own key. For zero-config use, point clients at the open `/mcp` mount instead.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleMcpRequest, mcpMethodNotAllowed } from "../../mcp/lib/handler"

export const POST = (req: MedusaRequest, res: MedusaResponse) =>
  handleMcpRequest(req, res)

export const GET = (req: MedusaRequest, res: MedusaResponse) =>
  mcpMethodNotAllowed(req, res)

export const DELETE = (req: MedusaRequest, res: MedusaResponse) =>
  mcpMethodNotAllowed(req, res)
