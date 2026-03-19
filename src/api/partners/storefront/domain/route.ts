import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"

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

  const vercelProjectId = partner.metadata?.vercel_project_id
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

  try {
    const config = await deployment.getDomainConfig(customDomain)
    return res.json({
      configured: true,
      domain: customDomain,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: config.misconfigured,
      configured_by: config.configuredBy,
    })
  } catch {
    return res.json({
      configured: true,
      domain: customDomain,
      verified: partner.metadata?.custom_domain_verified === true,
      misconfigured: true,
      configured_by: null,
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

  const vercelProjectId = partner.metadata?.vercel_project_id
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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  // Add domain to Vercel project
  const result = await deployment.addDomain(vercelProjectId, cleaned)

  // Get DNS config so we can show instructions
  let config: any = null
  try {
    config = await deployment.getDomainConfig(cleaned)
  } catch {
    // non-critical
  }

  // Save to partner metadata
  await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: {
        metadata: {
          ...(partner.metadata || {}),
          custom_domain: cleaned,
          custom_domain_verified: result.verified,
        },
      },
    },
  })

  res.status(201).json({
    domain: cleaned,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured: config?.misconfigured ?? true,
    configured_by: config?.configuredBy ?? null,
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

  const vercelProjectId = partner.metadata?.vercel_project_id
  const customDomain = partner.metadata?.custom_domain as string | undefined

  if (!vercelProjectId || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  try {
    await deployment.removeDomain(vercelProjectId, customDomain)
  } catch {
    // best-effort removal
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

  res.json({ message: "Custom domain removed" })
}
