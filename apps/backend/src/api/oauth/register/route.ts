/**
 * POST /oauth/register — dynamic client registration (RFC 7591), #1306 Track B.
 *
 * Unauthenticated by design. Claude web, ChatGPT and Cursor have no way to
 * pre-arrange a client id with us, so the spec has them register themselves
 * when a user first pastes the server URL.
 *
 * That is safe because **a client row grants nothing**. It is a display name
 * and a set of redirect URIs. Every capability comes from a token, and no token
 * exists until an admin has logged in on the consent screen and picked a rung
 * on the scope ladder. The registration endpoint cannot mint, widen, or imply
 * a grant.
 *
 * What it CAN do is create rows, so the input is bounded: a capped number of
 * redirect URIs, each one https / loopback / private-use-scheme, and no
 * `client_credentials` grant — this front door exists to act as a human admin,
 * so there is deliberately no grant type that skips the human.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  isAcceptableRedirectUri,
  randomSecret,
  sha256,
} from "../../../lib/mcp-oauth"
import { MCP_OAUTH_MODULE } from "../../../modules/mcp_oauth"
import type McpOauthService from "../../../modules/mcp_oauth/service"

/** More than this and the client is not describing a real application. */
const MAX_REDIRECT_URIS = 10

const MAX_CLIENT_NAME_LEN = 120

const SUPPORTED_GRANT_TYPES = new Set(["authorization_code", "refresh_token"])

const badRequest = (
  res: MedusaResponse,
  error: string,
  description: string
) => {
  res.status(400).json({ error, error_description: description })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as Record<string, any>

  const redirectUris: unknown = body.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return badRequest(
      res,
      "invalid_redirect_uri",
      "redirect_uris is required and must be a non-empty array."
    )
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return badRequest(
      res,
      "invalid_redirect_uri",
      `At most ${MAX_REDIRECT_URIS} redirect_uris may be registered.`
    )
  }
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isAcceptableRedirectUri(uri)) {
      return badRequest(
        res,
        "invalid_redirect_uri",
        `Unacceptable redirect_uri: ${String(uri).slice(0, 200)}. Use https, ` +
          `http on loopback, or a private-use scheme, with no fragment.`
      )
    }
  }

  const grantTypes: string[] = Array.isArray(body.grant_types)
    ? body.grant_types.map(String)
    : ["authorization_code", "refresh_token"]
  const unsupported = grantTypes.filter((g) => !SUPPORTED_GRANT_TYPES.has(g))
  if (unsupported.length) {
    return badRequest(
      res,
      "invalid_client_metadata",
      `Unsupported grant_types: ${unsupported.join(", ")}. This server issues ` +
        `tokens only through an admin's explicit consent, so authorization_code ` +
        `(+ refresh_token) are the only grants.`
    )
  }

  const responseTypes: string[] = Array.isArray(body.response_types)
    ? body.response_types.map(String)
    : ["code"]
  if (responseTypes.some((t) => t !== "code")) {
    return badRequest(
      res,
      "invalid_client_metadata",
      "Only the 'code' response_type is supported."
    )
  }

  const authMethod = String(body.token_endpoint_auth_method || "none")
  if (
    !["none", "client_secret_post", "client_secret_basic"].includes(authMethod)
  ) {
    return badRequest(
      res,
      "invalid_client_metadata",
      `Unsupported token_endpoint_auth_method: ${authMethod}.`
    )
  }

  const clientName = String(
    body.client_name || body.client_id || "Unnamed MCP client"
  ).slice(0, MAX_CLIENT_NAME_LEN)

  const service = req.scope.resolve(MCP_OAUTH_MODULE) as McpOauthService

  const clientId = `mcpc_${randomSecret(18)}`
  // Public clients (the ones this endpoint exists for) get no secret: PKCE is
  // what binds the authorization code to the client. A confidential client
  // sees its secret exactly once, in this response.
  const clientSecret = authMethod === "none" ? null : randomSecret(32)

  // Cast: DML types `model.json()` as Record<string, unknown>, so a string[]
  // of redirect URIs does not fit the generated input type even though it is
  // exactly what the column holds.
  const created = await service.createMcpOauthClients({
    client_id: clientId,
    client_secret_hash: clientSecret ? sha256(clientSecret) : null,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    token_endpoint_auth_method: authMethod,
    scope: typeof body.scope === "string" ? body.scope : null,
  } as any)

  const row = Array.isArray(created) ? created[0] : created

  return res.status(201).json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_id_issued_at: Math.floor(
      new Date(row?.created_at ?? Date.now()).getTime() / 1000
    ),
    // 0 = never expires (RFC 7591 §3.2.1). Revocation is per-token, not per
    // client, so there is nothing for a client secret expiry to protect.
    ...(clientSecret ? { client_secret_expires_at: 0 } : {}),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: authMethod,
  })
}
