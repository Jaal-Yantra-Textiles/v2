/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 (#1306 Track B).
 *
 * Tells a client where to register, where to send the user for consent, and
 * where to exchange the code. Advertises S256 as the only PKCE method: `plain`
 * offers no protection against a code intercepted on the redirect leg, which is
 * the single thing PKCE exists to stop.
 *
 * NOTE: registered as a middleware entry in `src/api/middlewares.ts` — Medusa's
 * file router ignores dot-directories. See the sibling
 * `oauth-protected-resource` route.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  authorizationServerMetadata,
  resolveOauthIssuer,
} from "../../../lib/mcp-oauth"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("cache-control", "public, max-age=300")
  res.json(authorizationServerMetadata(resolveOauthIssuer(req)))
}
