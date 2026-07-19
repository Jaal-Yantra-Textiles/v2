/**
 * POST /admin/mcp — the Admin MCP JSON-RPC endpoint.
 *
 * Admin-user authenticated (all /admin/* routes are, via Medusa). Lets MCP
 * clients — and the in-app admin assistant's confirmation step — drive the
 * Admin API as tools. Stateless Streamable HTTP: POST only; GET/DELETE → 405.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handleAdminMcpRequest,
  adminMcpMethodNotAllowed,
} from "./lib/handler"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await handleAdminMcpRequest(req, res)
}

export const GET = adminMcpMethodNotAllowed
export const DELETE = adminMcpMethodNotAllowed
