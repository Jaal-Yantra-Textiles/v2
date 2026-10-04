import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ConfigModule } from "@medusajs/framework/types"
import { generateJwtTokenForAuthIdentity } from "@medusajs/medusa/api/auth/utils/generate-jwt-token"

import { PHONE_PIN_AUTH_PROVIDER } from "../../../../modules/phone-pin-auth"
import { bearerFrom, verifyPartnerRefreshToken } from "./verify-refresh-token"

/**
 * POST /partners/auth/refresh
 *
 * Exchange a partner JWT — even an EXPIRED one, up to
 * PARTNER_REFRESH_GRACE_DAYS (30) days past its expiry — for a fresh one.
 *
 * Why it exists: Medusa signs every JWT with the global `http.jwtExpiresIn`
 * (default 1d; shared with MCP OAuth, so it must not change) and core
 * `POST /auth/token/refresh` sits behind `authenticate`, which rejects an
 * expired token. A partner who did not open the app for two days was simply
 * signed out.
 *
 * 🔴 PUBLIC route: it must NOT run behind `authenticate("partner", …)` — that
 * middleware is exactly what rejects the expired token. The token's signature
 * is the authentication, verified here with the framework's own key/options.
 *
 * Re-checked against the database on every call (reads only — no writes, so
 * a client retrying in a loop costs nothing but reads):
 *  - the auth identity still exists and its `app_metadata.partner_id` is still
 *    the token's partner;
 *  - the partner exists and is not `inactive`;
 *  - the identity still belongs to an admin of that partner (matched by the
 *    emailpass email, else the phone-pin number) and that admin `is_active`.
 *
 * Accepts the WhatsApp deep-link session tokens minted by `/partners/wa-auth`,
 * which carry no `auth_provider`. The new token is minted by Medusa's own
 * `generateJwtTokenForAuthIdentity` with `http.jwtExpiresIn` — the same claims
 * and lifetime a fresh login gets.
 *
 * Request:  Authorization: Bearer <partner JWT>   (no body)
 * 200:      { token }
 * 401:      { message }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const unauthorized = (message: string) => res.status(401).json({ message })

  const configModule = req.scope.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE)
  const http: any = configModule.projectConfig.http ?? {}

  const verified = verifyPartnerRefreshToken(bearerFrom(req.headers.authorization), {
    secret: http.jwtSecret,
    publicKey: http.jwtPublicKey,
    verifyOptions: http.jwtVerifyOptions ?? http.jwtOptions,
  })
  if (!verified.ok) {
    return unauthorized(verified.message)
  }
  const claims = verified.claims

  // 1. The auth identity still exists and still maps to this partner.
  const authModule: any = req.scope.resolve(Modules.AUTH)
  const authIdentity = await authModule
    .retrieveAuthIdentity(claims.auth_identity_id, { relations: ["provider_identities"] })
    .catch(() => null)
  if (!authIdentity) {
    return unauthorized("Auth identity not found")
  }
  if (authIdentity.app_metadata?.partner_id !== claims.actor_id) {
    return unauthorized("Auth identity no longer belongs to this partner")
  }

  // 2. The partner is still there and not deactivated, and this identity is
  //    still one of its active admins.
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "status", "admins.id", "admins.email", "admins.phone", "admins.is_active"],
    filters: { id: claims.actor_id },
  })
  const partner = partners?.[0]
  if (!partner || partner.status === "inactive") {
    return unauthorized("Partner not found or inactive")
  }

  const providerIdentities: any[] = authIdentity.provider_identities ?? []
  const email = providerIdentities
    .find((p) => p?.provider === "emailpass")
    ?.entity_id?.toLowerCase?.()
  const phone = providerIdentities.find((p) => p?.provider === PHONE_PIN_AUTH_PROVIDER)?.entity_id
  const admins: any[] = (partner.admins ?? []).filter(Boolean)
  const admin =
    (email && admins.find((a) => a?.email?.toLowerCase?.() === email)) ||
    (phone && admins.find((a) => a?.phone && a.phone === phone)) ||
    null
  if (!admin) {
    return unauthorized("No partner admin for this identity")
  }
  if (admin.is_active === false) {
    return unauthorized("Partner admin is inactive")
  }

  // 3. Mint with Medusa's own helper and lifetime. A wa-auth token carries no
  //    `auth_provider`; the new one names the provider the identity actually
  //    has, so it matches a normal login's claims.
  const authProvider =
    claims.auth_provider ||
    (providerIdentities.some((p) => p?.provider === "emailpass") ? "emailpass" : undefined)

  const token = await generateJwtTokenForAuthIdentity(
    {
      authIdentity,
      actorType: "partner",
      authProvider,
      container: req.scope,
      mfaChallengeCompletedAt: (claims.mfa_challenge_completed_at as any) ?? undefined,
    } as any,
    {
      secret: http.jwtSecret,
      expiresIn: http.jwtExpiresIn,
      options: http.jwtOptions,
    } as any
  )

  return res.status(200).json({ token })
}
