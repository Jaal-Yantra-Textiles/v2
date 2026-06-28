/**
 * POST /mcp — open, zero-config MCP endpoint.
 *
 * Outside the `/store` namespace, so Medusa's publishable-key middleware does
 * NOT gate it. Callers can connect with just the URL; the handler injects the
 * server's default public key (STORE_MCP_DEFAULT_PUBLISHABLE_KEY) when no
 * `x-publishable-api-key` header is sent, and honors a caller-supplied key for
 * partner-scoped access.
 *
 * Read-only: the cart/checkout/PayU *write* tools are NOT available here even
 * when STORE_MCP_ENABLE_WRITE is on — they require a validated publishable key,
 * which only the gated `/store/mcp` mount provides. Point write clients there.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleMcpRequest, mcpMethodNotAllowed } from "./lib/handler"

export const POST = (req: MedusaRequest, res: MedusaResponse) =>
  handleMcpRequest(req, res)

export const GET = (req: MedusaRequest, res: MedusaResponse) =>
  mcpMethodNotAllowed(req, res)

export const DELETE = (req: MedusaRequest, res: MedusaResponse) =>
  mcpMethodNotAllowed(req, res)
