import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"
import type { VercelDomainConfig } from "../../../../modules/deployment/service"
import { WEBSITE_MODULE } from "../../../../modules/website"
import type WebsiteService from "../../../../modules/website/service"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"
import {
  attachStorefrontDomainWorkflow,
  deriveDomainPair,
} from "../../../../workflows/partners/attach-storefront-domain"
import { getStorefrontRefs } from "../helpers"

/**
 * Determines if a domain is an apex (root) domain.
 * e.g. "example.com" → true, "shop.example.com" → false, "www.example.com" → false
 */
function isApexDomain(domain: string): boolean {
  const parts = domain.split(".")
  return parts.length === 2
}

/**
 * Extracts recommended DNS records from Vercel domain config.
 * Returns the appropriate record type based on whether the domain is apex or subdomain.
 */
function buildDnsRecords(
  domain: string,
  config: VercelDomainConfig | null
): Array<{ type: string; host: string; value: string }> {
  const apex = isApexDomain(domain)

  if (apex) {
    // Apex domains need an A record (CNAME not allowed on root)
    const ipv4 = config?.recommendedIPv4?.[0]?.value?.[0] || "76.76.21.21"
    return [
      { type: "A", host: "@", value: ipv4 },
    ]
  }

  // Subdomains (including www) use CNAME
  const cname =
    config?.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com"
  // Extract the subdomain part (e.g. "shop" from "shop.example.com")
  const parts = domain.split(".")
  const host = parts.slice(0, parts.length - 2).join(".")

  return [{ type: "CNAME", host, value: cname }]
}

/**
 * GET /partners/storefront/domain
 * Returns the custom domain status and DNS configuration instructions.
 */
export const GET = async (
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
  if (!vercelProjectId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const customDomain = partner.metadata?.custom_domain as string | undefined
  if (!customDomain) {
    return res.json({ configured: false })
  }

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  const pair = deriveDomainPair(customDomain)
  const buildPairRecords = (config: VercelDomainConfig | null) => {
    const records = [...buildDnsRecords(pair.primary, config)]
    if (pair.counterpart) {
      records.push(...buildDnsRecords(pair.counterpart, config))
    }
    return records
  }

  try {
    const config = await deployment.getDomainConfig(customDomain)
    return res.json({
      configured: true,
      domain: customDomain,
      redirect_from: pair.counterpart,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: config.misconfigured,
      configured_by: config.configuredBy,
      dns_records: buildPairRecords(config),
    })
  } catch {
    return res.json({
      configured: true,
      domain: customDomain,
      redirect_from: pair.counterpart,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: true,
      configured_by: null,
      dns_records: buildPairRecords(null),
    })
  }
}

/**
 * POST /partners/storefront/domain
 * Add a custom domain to the Vercel project.
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
  if (!vercelProjectId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const { domain } = req.body as { domain?: string }
  if (!domain || typeof domain !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "domain is required"
    )
  }

  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")
  if (!cleaned || cleaned.length < 3 || !cleaned.includes(".")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Please enter a valid domain name (e.g. shop.example.com)"
    )
  }

  // Roadmap #17 — the whole attach (Vercel www+apex pair with redirect,
  // NEXT_PUBLIC_BASE_URL env, partner metadata, website_domain aliases)
  // lives in the workflow with compensation.
  const websiteId =
    ((partner as any).website_id || partner.metadata?.website_id || null) as
      | string
      | null

  const { result } = await attachStorefrontDomainWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      vercel_project_id: vercelProjectId,
      website_id: websiteId,
      domain: cleaned,
      prev_metadata: (partner.metadata || {}) as Record<string, any>,
    },
  })

  // DNS instructions for both hosts (best-effort).
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  let config: VercelDomainConfig | null = null
  try {
    config = await deployment.getDomainConfig(result.primary)
  } catch {
    // non-critical
  }
  const dnsRecords = [...buildDnsRecords(result.primary, config)]
  if (result.counterpart) {
    dnsRecords.push(...buildDnsRecords(result.counterpart, config))
  }

  res.status(201).json({
    domain: result.primary,
    redirect_from: result.counterpart,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured: config?.misconfigured ?? true,
    configured_by: config?.configuredBy ?? null,
    dns_records: dnsRecords,
  })
}

/**
 * DELETE /partners/storefront/domain
 * Remove the custom domain from the Vercel project.
 */
export const DELETE = async (
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

  // Remove BOTH hosts (primary + its www/apex twin — see deriveDomainPair)
  const pair = deriveDomainPair(customDomain)
  const hosts = [pair.primary, pair.counterpart].filter(
    (h): h is string => !!h
  )
  for (const host of hosts) {
    try {
      await deployment.removeDomain(vercelProjectId, host)
    } catch {
      // best-effort removal
    }
  }

  // Clear from metadata
  const meta = { ...(partner.metadata || {}) }
  delete meta.custom_domain
  delete meta.custom_domain_verified

  await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: { metadata: meta },
    },
  })

  // Soft-delete the alias rows so lookups stop resolving the custom domain
  try {
    const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
    for (const host of hosts) {
      const [rows] = await (websiteService as any).listAndCountWebsiteDomains(
        { domain: host },
        { take: 1 }
      )
      const row = rows?.[0]
      if (row && !row.is_primary) {
        await (websiteService as any).softDeleteWebsiteDomains(row.id)
      }
    }
  } catch {
    // best-effort
  }

  res.json({ message: "Custom domain removed" })
}
