/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 (#1306 Track B).
 *
 * The first document an MCP client fetches after a 401 from `/mcp/admin`. It
 * names the resource and points at the authorization server, which is this
 * same origin.
 *
 * NOTE: Medusa's file-based router ignores directories starting with ".", so
 * the actual route is registered from this handler as a middleware entry in
 * `src/api/middlewares.ts` — the `/.well-known/ucp` precedent. Exported rather
 * than inlined there so the two cannot drift.
 *
 * Clients also probe the path-suffixed form
 * (`/.well-known/oauth-protected-resource/mcp/admin`); both matchers point
 * here, and the body is identical because this server protects exactly one
 * resource.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  protectedResourceMetadata,
  resolveOauthIssuer,
} from "../../../lib/mcp-oauth"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("cache-control", "public, max-age=300")
  res.json(protectedResourceMetadata(resolveOauthIssuer(req)))
}
