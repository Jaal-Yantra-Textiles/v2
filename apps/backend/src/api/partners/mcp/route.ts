/**
 * POST /partners/mcp — the Partner MCP JSON-RPC endpoint.
 *
 * Partner-authenticated (see middlewares.ts). Lets MCP clients — and the in-app
 * assistant's confirmation step — drive the Partner API as tools. Stateless
 * Streamable HTTP: POST only; GET/DELETE return 405.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handlePartnerMcpRequest,
  partnerMcpMethodNotAllowed,
} from "./lib/handler"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await handlePartnerMcpRequest(req, res)
}

export const GET = partnerMcpMethodNotAllowed
export const DELETE = partnerMcpMethodNotAllowed
