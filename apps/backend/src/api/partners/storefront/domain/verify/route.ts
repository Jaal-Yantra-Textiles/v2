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
  const customDomain = partner.metadata?.custom_domain as string | undefined

  if (!projectRef || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  // Vercel-only: apply Vercel's recommended DNS via Cloudflare. No-op for
  // domains outside our zone; skipped entirely for non-Vercel providers.
  let applied: any = null
  if (providerName === "vercel") {
    const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
    applied = await deployment.applyRecommendedDns(customDomain)
  }

  // Verify after applying so a successful CF write can flip verified=true in
  // the same call (subject to the provider's propagation window).
  const result = await provider.verifyDomain(projectRef, customDomain)

  if (result.verified) {
    await updatePartnerWorkflow(req.scope).run({
      input: {
        id: partner.id,
        data: {
          metadata: {
            ...(partner.metadata || {}),
            custom_domain_verified: true,
          },
        },
      },
    })
  }

  const status = await provider
    .describeDomain(projectRef, customDomain)
    .catch(() => null)

  res.json({
    domain: customDomain,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured: status?.misconfigured ?? true,
    configured_by: status?.configuredBy ?? null,
    applied,
    dns_records: status?.dnsRecords ?? [],
  })
}
