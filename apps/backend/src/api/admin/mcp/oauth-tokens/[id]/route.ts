/**
 * DELETE /admin/mcp/oauth-tokens/:id — revoke one OAuth authorization
 * (#1306 Track B).
 *
 * Takes effect on the very next request: the access token is a self-verifying
 * JWT, so what makes this immediate is the `/admin/*` revocation global in
 * `src/api/middlewares.ts`, which reads this row on every request that carries
 * an `mcp_oauth` claim — reads included.
 *
 * The scope row is narrowed to `read` rather than deleted. A deleted row means
 * "no restriction", i.e. the process ceiling — so removing it while some other
 * path still accepted the token would WIDEN the credential at the exact moment
 * it was meant to lose access. Failing safe here costs one stale row.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MCP_ACCESS_MODULE } from "../../../../../modules/mcp_access"
import type McpAccessService from "../../../../../modules/mcp_access/service"
import { MCP_OAUTH_MODULE } from "../../../../../modules/mcp_oauth"
import type McpOauthService from "../../../../../modules/mcp_oauth/service"
import { refuseNonHumanAdmin } from "../route"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  if (refuseNonHumanAdmin(req, res)) return

  const id = String((req.params as any).id || "")
  const service = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
  const row = await service.getToken(id)
  if (!row) {
    return res.status(404).json({ message: `No OAuth authorization ${id}.` })
  }

  await service.revokeToken(id)

  try {
    const access = req.scope.resolve(MCP_ACCESS_MODULE) as McpAccessService
    await access.setScope({
      principal_type: "oauth",
      principal_id: id,
      level: "read",
      note: `Revoked ${new Date().toISOString()} — retained at 'read' because a missing scope row means the process ceiling, not zero.`,
    })
  } catch {
    // The revocation itself has already landed and is what is enforced; a
    // failure to also narrow the (now unreachable) scope row must not turn a
    // successful revoke into an error the admin retries.
  }

  res.json({ id, revoked: true })
}
