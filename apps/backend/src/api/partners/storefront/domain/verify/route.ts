import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../../modules/deployment"
import type DeploymentService from "../../../../../modules/deployment/service"
import type { VercelDomainConfig } from "../../../../../modules/deployment/service"
import updatePartnerWorkflow from "../../../../../workflows/partners/update-partner"
import { getStorefrontRefs } from "../../helpers"

function isApexDomain(domain: string): boolean {
  return domain.split(".").length === 2
}

function buildDnsRecords(
  domain: string,
  config: VercelDomainConfig | null
): Array<{ type: string; host: string; value: string }> {
  if (isApexDomain(domain)) {
    const ipv4 = config?.recommendedIPv4?.[0]?.value?.[0] || "76.76.21.21"
    return [{ type: "A", host: "@", value: ipv4 }]
  }
  const cname = config?.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com"
  const parts = domain.split(".")
  const host = parts.slice(0, parts.length - 2).join(".")
  return [{ type: "CNAME", host, value: cname }]
}

/**
 * POST /partners/storefront/domain/verify
 *
 * Re-checks Vercel domain ownership AND — when the domain lives inside
 * the Cloudflare zone we control — pushes whatever DNS Vercel currently
 * recommends so the domain self-heals without operator intervention.
 *
 * Apply-step behaviour:
 *   - Always attempts applyRecommendedDns(domain). The deployment service
 *     skips/fails gracefully when CF isn't configured or the domain isn't
 *     in our zone, so partner-owned domains (shop.example.com) fall
 *     through to the existing "return instructions" path unharmed.
 *   - Re-verifies with Vercel after applying so the response reflects the
 *     post-apply state (DNS propagation can still cause this to remain
 *     false for a few minutes).
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

  const vercelProjectId = getStorefrontRefs(partner).vercelProjectId
  const customDomain = partner.metadata?.custom_domain as string | undefined

  if (!vercelProjectId || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  // Apply Vercel's recommended DNS via Cloudflare. No-op for domains
  // outside our zone — they'll get the instructions in dns_records below.
  const applied = await deployment.applyRecommendedDns(customDomain)

  // Verify after applying so a successful CF write can flip verified=true
  // in the same call (subject to Vercel's propagation window).
  const result = await deployment.verifyDomain(vercelProjectId, customDomain)

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

  let config: VercelDomainConfig | null = null
  try {
    config = await deployment.getDomainConfig(customDomain)
  } catch {
    // non-critical
  }

  res.json({
    domain: customDomain,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured: config?.misconfigured ?? true,
    configured_by: config?.configuredBy ?? null,
    applied,
    dns_records: buildDnsRecords(customDomain, config),
  })
}
