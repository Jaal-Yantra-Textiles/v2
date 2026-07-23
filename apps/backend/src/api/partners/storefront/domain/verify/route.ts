import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../../modules/deployment"
import type DeploymentService from "../../../../../modules/deployment/service"
import { resolveHostingProviderForPartner } from "../../../../../modules/deployment/providers/resolve-partner-provider"
import updatePartnerWorkflow from "../../../../../workflows/partners/update-partner"
import {
  deriveDomainPair,
  partnerCustomDomain,
} from "../../../../../workflows/partners/attach-storefront-domain"

/**
 * POST /partners/storefront/domain/verify
 *
 * Re-checks domain ownership with the partner's hosting provider AND — for
 * Vercel partners whose domain lives inside the Cloudflare zone we control —
 * pushes whatever DNS Vercel currently recommends so the domain self-heals
 * without operator intervention.
 *
 * Provider dispatch:
 *   - `provider.verifyDomain` re-checks attachment (Vercel verify / Pages
 *     re-validate).
 *   - `provider.describeDomain` returns the current DNS instructions + status.
 *   - The Cloudflare-zone auto-apply is Vercel-recommendation-specific, so it
 *     only runs for Vercel partners; other providers skip it gracefully
 *     (partner-owned domains outside our zone were always a no-op anyway).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { providerName, provider, projectRef } =
    await resolveHostingProviderForPartner(partner, req.scope)
  const customDomain = partnerCustomDomain(partner)

  if (!projectRef || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  const pair = deriveDomainPair(customDomain)
  const healErrors: string[] = []
  let applied: any = null

  if (providerName === "vercel") {
    // Vercel-only: apply Vercel's recommended DNS via Cloudflare. No-op for
    // domains outside our zone.
    const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
    applied = await deployment.applyRecommendedDns(customDomain)
  } else {
    // Self-heal: idempotently (re)attach each host. `addDomain` reuses an
    // existing provider hostname or creates a missing one — so a domain that
    // was saved before its custom hostname existed (the classic "added during a
    // broken window, then Check Status only ever *verified*, never *created*")
    // gets recreated here instead of sitting unverifiable forever.
    const hosts = [pair.primary, pair.counterpart].filter(
      (h): h is string => !!h
    )
    for (const host of hosts) {
      try {
        const r = await provider.addDomain(
          projectRef,
          host,
          host === pair.primary
            ? undefined
            : { redirect: pair.primary, redirectStatusCode: 308 }
        )
        if (r?.error) healErrors.push(`${host}: ${r.error}`)
      } catch (e: any) {
        healErrors.push(`${host}: ${e?.message || e}`)
      }
    }
  }

  // Verify after (re)attaching so a freshly-created/validated hostname can flip
  // verified=true in the same call (subject to the propagation window).
  const result = await provider.verifyDomain(projectRef, pair.primary)

  if (result.verified) {
    await updatePartnerWorkflow(req.scope).run({
      input: {
        id: partner.id,
        data: { custom_domain_verified: true },
      },
    })
  }

  // Aggregate status + DNS/verification records across the apex/www pair.
  const primaryStatus = await provider
    .describeDomain(projectRef, pair.primary)
    .catch(() => null)
  const records = [...(primaryStatus?.dnsRecords ?? [])]
  let verification =
    result.verification || primaryStatus?.verification || []
  if (pair.counterpart) {
    const twin = await provider
      .describeDomain(projectRef, pair.counterpart)
      .catch(() => null)
    if (twin) {
      records.push(...twin.dnsRecords)
      if (!verification.length && twin.verification?.length) {
        verification = twin.verification
      }
    }
  }

  res.json({
    domain: customDomain,
    verified: result.verified,
    verification,
    misconfigured: primaryStatus?.misconfigured ?? true,
    configured_by: primaryStatus?.configuredBy ?? null,
    applied,
    dns_records: records,
    ...(healErrors.length ? { error: healErrors.join("; ") } : {}),
  })
}
