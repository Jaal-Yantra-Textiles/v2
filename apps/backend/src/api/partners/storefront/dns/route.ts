import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"
import { getStorefrontRefs } from "../helpers"

/**
 * POST /partners/storefront/dns
 *
 * Re-reads Vercel's currently-recommended DNS for a partner-owned domain
 * and pushes it into Cloudflare. Defaults to the partner's primary
 * `storefront_domain` (e.g. uniquepashmina.cicilabel.com), or accepts a
 * `domain` in the body to target a custom domain. Idempotent — safe to
 * call when a partner sees "Update your DNS" instructions from Vercel
 * because we shipped a generic CNAME before Vercel had a project-specific
 * target ready (e.g. dc034fcb6b63fdce.vercel-dns-017.com).
 *
 * Skipped/failed apply does not error the response — the body always
 * carries the apply result so the caller can decide what to surface.
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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const applied = await deployment.applyRecommendedDns(domain)

  // Best-effort: fetch domain config so the caller can show the recommendation
  // alongside what was actually applied.
  let recommendation: Awaited<
    ReturnType<DeploymentService["getDomainConfig"]>
  > | null = null
  try {
    recommendation = await deployment.getDomainConfig(domain)
  } catch {
    // non-critical
  }

  res.json({
    domain,
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
