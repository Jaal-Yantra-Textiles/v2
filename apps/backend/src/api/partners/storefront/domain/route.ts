import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { resolveHostingProviderForPartner } from "../../../../modules/deployment/providers/resolve-partner-provider"
import type { HostingDomainStatus } from "../../../../modules/deployment/providers/types"
import { WEBSITE_MODULE } from "../../../../modules/website"
import type WebsiteService from "../../../../modules/website/service"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"
import {
  attachStorefrontDomainWorkflow,
  deriveDomainPair,
} from "../../../../workflows/partners/attach-storefront-domain"

/**
 * GET /partners/storefront/domain
 * Returns the custom domain status and DNS configuration instructions,
 * dispatched to whichever hosting provider the partner's storefront runs on.
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

  const { provider, projectRef } = await resolveHostingProviderForPartner(
    partner,
    req.scope
  )
  if (!projectRef) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const customDomain = partner.metadata?.custom_domain as string | undefined
  if (!customDomain) {
    return res.json({ configured: false })
  }

  const pair = deriveDomainPair(customDomain)

  try {
    const primary = await provider.describeDomain(projectRef, pair.primary)
    const records = [...primary.dnsRecords]
    if (pair.counterpart) {
      const twin = await provider.describeDomain(projectRef, pair.counterpart)
      records.push(...twin.dnsRecords)
    }
    return res.json({
      configured: true,
      domain: customDomain,
      redirect_from: pair.counterpart,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: primary.misconfigured,
      configured_by: primary.configuredBy ?? null,
      dns_records: records,
    })
  } catch {
    return res.json({
      configured: true,
      domain: customDomain,
      redirect_from: pair.counterpart,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: true,
      configured_by: null,
      dns_records: [],
    })
  }
}

/**
 * POST /partners/storefront/domain
 * Add a custom domain to the partner's storefront project (provider-agnostic:
 * the attach workflow resolves the partner's provider internally).
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

  const { provider, projectRef } = await resolveHostingProviderForPartner(
    partner,
    req.scope
  )
  if (!projectRef) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const { domain } = req.body as { domain?: string }
  if (!domain || typeof domain !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "domain is required")
  }

  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")
  if (!cleaned || cleaned.length < 3 || !cleaned.includes(".")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Please enter a valid domain name (e.g. shop.example.com)"
    )
  }

  const websiteId =
    ((partner as any).website_id || partner.metadata?.website_id || null) as
      | string
      | null

  const { result } = await attachStorefrontDomainWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      website_id: websiteId,
      domain: cleaned,
      prev_metadata: (partner.metadata || {}) as Record<string, any>,
    },
  })

  // DNS instructions for both hosts (best-effort, provider-specific).
  const dnsRecords: HostingDomainStatus["dnsRecords"] = []
  let misconfigured = true
  let configuredBy: string | null = null
  try {
    const primary = await provider.describeDomain(projectRef, result.primary)
    dnsRecords.push(...primary.dnsRecords)
    misconfigured = primary.misconfigured
    configuredBy = primary.configuredBy ?? null
    if (result.counterpart) {
      const twin = await provider.describeDomain(projectRef, result.counterpart)
      dnsRecords.push(...twin.dnsRecords)
    }
  } catch {
    // non-critical — the partner can refresh via the verify endpoint
  }

  res.status(201).json({
    domain: result.primary,
    redirect_from: result.counterpart,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured,
    configured_by: configuredBy,
    dns_records: dnsRecords,
  })
}

/**
 * DELETE /partners/storefront/domain
 * Remove the custom domain from the partner's storefront project.
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

  const { provider, projectRef } = await resolveHostingProviderForPartner(
    partner,
    req.scope
  )
  const customDomain = partner.metadata?.custom_domain as string | undefined

  if (!projectRef || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  // Remove BOTH hosts (primary + its www/apex twin — see deriveDomainPair)
  const pair = deriveDomainPair(customDomain)
  const hosts = [pair.primary, pair.counterpart].filter(
    (h): h is string => !!h
  )
  for (const host of hosts) {
    try {
      await provider.removeDomain(projectRef, host)
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
