/**
 * GET /admin/mcp/oauth-tokens — every authorization the OAuth front door has
 * issued (#1306 Track B).
 *
 * The counterpart to `/admin/mcp/scopes`: that lists what a credential MAY do,
 * this lists which credentials EXIST and who let them in. Without it, revoking
 * an OAuth client would mean knowing a `mcpt_…` id you were never shown.
 *
 * ⚠️ HUMAN ADMINS ONLY, for the same reason as the scopes route — a machine
 * credential must not be able to enumerate or revoke its siblings, and
 * emphatically must not be able to see whether it is itself about to be
 * revoked. Deliberately NOT exposed as an MCP tool.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { mcpPrincipalFromRequest } from "../../../../lib/mcp-scope"
import { MCP_OAUTH_MODULE } from "../../../../modules/mcp_oauth"
import type McpOauthService from "../../../../modules/mcp_oauth/service"

export const refuseNonHumanAdmin = (
  req: MedusaRequest,
  res: MedusaResponse
): boolean => {
  const principal = mcpPrincipalFromRequest(req)
  if (principal && principal.type === "user") {
    return false
  }
  res.status(403).json({
    message:
      "OAuth authorizations can only be managed by a signed-in admin user. A " +
      "machine credential cannot list or revoke them.",
  })
  return true
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  if (refuseNonHumanAdmin(req, res)) return

  const service = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
  const rows = (await service.listMcpOauthTokens(
    {},
    { order: { created_at: "DESC" } }
  )) as any[]

  res.json({
    tokens: rows.map((t) => ({
      id: t.id,
      client_id: t.client_id,
      client_name: (t.metadata as any)?.client_name ?? null,
      // The admin this authorization acts AS — an OAuth token is a user JWT,
      // so every action it takes is attributed to this person.
      user_id: t.user_id,
      level: t.level,
      revoked_at: t.revoked_at,
      last_used_at: t.last_used_at,
      access_expires_at: t.access_expires_at,
      refresh_expires_at: t.refresh_expires_at,
      created_at: t.created_at,
    })),
  })
}
