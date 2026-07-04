import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"
import { resolveHostingProviderForPartner } from "../../../../modules/deployment/providers/resolve-partner-provider"
import { getStorefrontRefs } from "../helpers"

/**
 * POST /partners/storefront/dns
 *
 * Re-applies the correct DNS for a partner's storefront subdomain that lives
 * inside a Cloudflare zone we control. Defaults to the partner's primary
 * `storefront_domain`, or accepts a `domain` in the body. Idempotent.
 *
 * Provider dispatch:
 *   - Vercel → `applyRecommendedDns` pushes Vercel's per-project
 *     recommendation (e.g. `dc034fcb6b63fdce.vercel-dns-017.com`).
 *   - Cloudflare Pages → upsert a CNAME to `<project>.pages.dev`.
 *
 * Skipped/failed apply does not error the response — the body always carries
 * the apply result so the caller can decide what to surface.
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

  const refs = getStorefrontRefs(partner)
  const { domain: bodyDomain } = (req.body || {}) as { domain?: string }
  const domain = bodyDomain?.trim() || refs.storefrontDomain

  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned and no domain was supplied"
    )
  }

  const { providerName, provider, projectRef } =
    await resolveHostingProviderForPartner(partner, req.scope)
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  if (providerName === "vercel") {
    const applied = await deployment.applyRecommendedDns(domain)

    let recommendation: Awaited<
      ReturnType<DeploymentService["getDomainConfig"]>
    > | null = null
    try {
      recommendation = await deployment.getDomainConfig(domain)
    } catch {
      // non-critical
    }

    return res.json({
      domain,
      provider: providerName,
      applied,
      recommendation: recommendation
        ? {
            misconfigured: recommendation.misconfigured,
            recommended_cname: recommendation.recommendedCNAME?.[0]?.value ?? null,
            recommended_ipv4: recommendation.recommendedIPv4?.[0]?.value?.[0] ?? null,
          }
        : null,
    })
  }

  // Non-Vercel providers (Cloudflare Pages today): the origin is a stable
  // CNAME target derived from the project, so upsert that directly.
  const target = provider.dnsTarget({
    id: projectRef || domain,
    name: projectRef || domain,
  })
  const applied = await deployment.ensureCname(domain, target)

  return res.json({
    domain,
    provider: providerName,
    applied,
    recommendation: { misconfigured: applied.action === "failed", recommended_cname: target, recommended_ipv4: null },
  })
}
