/**
 * @file Admin write-proxy: verify a partner's storefront custom domain.
 * @module API/Admin/Partners/Storefront/Domain/Verify
 *
 * Admin-side mirror of `src/api/partners/storefront/domain/verify/route.ts`.
 * Resolves the partner from the `:id` URL param instead of `req.auth_context`.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerInspectionRecord } from "../../../lib/partner-inspection"
import { DEPLOYMENT_MODULE } from "../../../../../../../modules/deployment"
import type DeploymentService from "../../../../../../../modules/deployment/service"
import { resolveHostingProviderForPartner } from "../../../../../../../modules/deployment/providers/resolve-partner-provider"
import updatePartnerWorkflow from "../../../../../../../workflows/partners/update-partner"
import {
  deriveDomainPair,
  partnerCustomDomain,
} from "../../../../../../../workflows/partners/attach-storefront-domain"

/**
 * POST /admin/partners/:id/storefront/domain/verify
 *
 * Re-checks domain ownership with the partner's hosting provider AND — for
 * Vercel partners whose domain lives inside the Cloudflare zone we control —
 * pushes whatever DNS Vercel currently recommends so the domain self-heals
 * without operator intervention. Mirrors the partner verify endpoint.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const partner = await getPartnerInspectionRecord(partnerId, req.scope)

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
    // Self-heal: idempotently (re)attach each host.
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
