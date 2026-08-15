/**
 * DELETE /admin/mcp/scopes/:id — remove a credential's scope row (#1306 Track C).
 *
 * Deleting a row WIDENS the credential back to the process ceiling; it does not
 * revoke it. To take access away, revoke the API key in Medusa (or set the row's
 * level to `read`) — this endpoint is "stop restricting", not "block".
 *
 * Human admins only, for the same reason as the collection route: a machine
 * credential deleting its own row would be a one-call escalation to the ceiling.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MCP_ACCESS_MODULE } from "../../../../../modules/mcp_access"
import type McpAccessService from "../../../../../modules/mcp_access/service"
import { mcpPrincipalFromRequest } from "../../../../../lib/mcp-scope"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const principal = mcpPrincipalFromRequest(req)
  if (!principal || principal.type !== "user") {
    return res.status(403).json({
      message:
        "MCP scopes can only be managed by a signed-in admin user. A machine " +
        "credential cannot remove its own scope.",
    })
  }

  const { id } = req.params
  const service = req.scope.resolve(MCP_ACCESS_MODULE) as McpAccessService

  const existing = await service.listMcpAccessScopes({ id })
  if (!existing?.[0]) {
    return res.status(404).json({ message: `MCP scope '${id}' not found.` })
  }

  await service.deleteMcpAccessScopes(id)

  res.json({ id, object: "mcp_access_scope", deleted: true })
}
