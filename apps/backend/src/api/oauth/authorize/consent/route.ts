/**
 * POST /oauth/authorize/consent — turn an admin's approval into an
 * authorization code (#1306 Track B).
 *
 * Authenticated as an admin `user` (registered in `src/api/middlewares.ts`;
 * `/oauth/*` is otherwise unauthenticated). The consent page obtains that
 * bearer from Medusa's own `POST /auth/user/emailpass` moments earlier, so the
 * approval is bound to a password the human just typed and carries no ambient
 * authority.
 *
 * Everything the consent page sent is re-validated here. That page is HTML we
 * emitted, but nothing stops a client from posting to this endpoint directly —
 * the parameters are a request, not a trust boundary.
 *
 * ⚠️ An admin cannot grant more than the process ceiling. `min(ceiling,
 * chosen)` is applied before the row is written, so `ADMIN_MCP_ENABLE_DANGEROUS
 * = false` still means no OAuth client anywhere can reach a dangerous tool.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { minMcpScope } from "../../../../lib/mcp-core/tiers"
import {
  MCP_OAUTH_CODE_TTL_SEC,
  asScopeLevel,
  randomSecret,
  redirectUriRegistered,
  sha256,
} from "../../../../lib/mcp-oauth"
import { adminMcpCeiling } from "../../../admin/mcp/lib/handler"
import { MCP_OAUTH_MODULE } from "../../../../modules/mcp_oauth"
import type McpOauthService from "../../../../modules/mcp_oauth/service"

const fail = (res: MedusaResponse, status: number, error: string, description: string) => {
  res.status(status).json({ error, error_description: description })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const auth = (req as any).auth_context
  const userId: string | undefined = auth?.actor_id
  if (!userId || auth?.actor_type !== "user") {
    return fail(
      res,
      401,
      "access_denied",
      "Sign in as an admin user before approving."
    )
  }
  // A token minted by this very flow must not be able to mint another. Without
  // this, a `read`-scoped OAuth client could bootstrap itself a `dangerous`
  // one — the consent step is where a HUMAN is the point.
  if (auth?.mcp_oauth) {
    return fail(
      res,
      403,
      "access_denied",
      "An OAuth-issued token cannot authorize another client. Sign in with your password."
    )
  }

  const body = (req.body ?? {}) as Record<string, any>
  const clientId = String(body.client_id || "")
  const redirectUri = String(body.redirect_uri || "")
  const codeChallenge = String(body.code_challenge || "")
  const codeChallengeMethod = String(
    body.code_challenge_method || "S256"
  ).toUpperCase()

  if (!clientId || !redirectUri || !codeChallenge) {
    return fail(
      res,
      400,
      "invalid_request",
      "client_id, redirect_uri and code_challenge are all required."
    )
  }
  if (codeChallengeMethod !== "S256") {
    return fail(
      res,
      400,
      "invalid_request",
      "code_challenge_method must be S256."
    )
  }

  const service = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService
  const client = await service.getClient(clientId)
  if (!client) {
    return fail(res, 400, "invalid_client", "Unknown client_id.")
  }
  if (!redirectUriRegistered(client.redirect_uris, redirectUri)) {
    return fail(
      res,
      400,
      "invalid_request",
      "redirect_uri does not match a registered value."
    )
  }

  const level = minMcpScope(adminMcpCeiling(), asScopeLevel(body.level))

  const code = randomSecret(32)
  await service.createMcpOauthGrants({
    code_hash: sha256(code),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    user_id: userId,
    auth_identity_id: auth?.auth_identity_id || null,
    level,
    state: typeof body.state === "string" && body.state ? body.state : null,
    expires_at: new Date(Date.now() + MCP_OAUTH_CODE_TTL_SEC * 1000),
  })

  const url = new URL(redirectUri)
  url.searchParams.set("code", code)
  if (body.state) url.searchParams.set("state", String(body.state))

  // Returned as JSON rather than a 302: the caller is a fetch() inside the
  // consent page, and a redirect there would be followed by the browser
  // instead of navigating the top-level document to the client.
  res.setHeader("cache-control", "no-store")
  return res.json({ redirect_to: url.toString(), level })
}
