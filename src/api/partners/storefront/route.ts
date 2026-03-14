import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { DEPLOYMENT_MODULE } from "../../../modules/deployment"
import type DeploymentService from "../../../modules/deployment/service"
import updatePartnerWorkflow from "../../../workflows/partners/update-partner"

const STOREFRONT_META_KEYS = [
  "vercel_project_id",
  "vercel_project_name",
  "storefront_domain",
  "storefront_provisioned_at",
]

function stripStorefrontKeys(metadata: any): Record<string, any> | null {
  const current = (metadata || {}) as Record<string, any>
  const clean: Record<string, any> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!STOREFRONT_META_KEYS.includes(key)) {
      clean[key] = value
    }
  }
  return Object.keys(clean).length > 0 ? clean : null
}

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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const vercelProjectId = partner.metadata?.vercel_project_id

  if (!vercelProjectId) {
    return res.json({
      provisioned: false,
      message: "Storefront has not been provisioned yet",
      vercel_configured: deployment.isVercelConfigured(),
      cloudflare_configured: deployment.isCloudflareConfigured(),
    })
  }

  try {
    const project = await deployment.getProject(vercelProjectId)
    const latestDeployment = project.latestDeployments?.[0]

    let deploymentInfo: {
      id: string
      url: string
      status: string
      created_at: number
    } | null = null

    if (latestDeployment) {
      try {
        const details = await deployment.getDeployment(latestDeployment.id)
        deploymentInfo = {
          id: details.id,
          url: details.url,
          status: details.readyState,
          created_at: details.createdAt,
        }
      } catch {
        deploymentInfo = {
          id: latestDeployment.id,
          url: latestDeployment.url,
          status: latestDeployment.readyState,
          created_at: latestDeployment.createdAt,
        }
      }
    }

    res.json({
      provisioned: true,
      project: {
        id: project.id,
        name: project.name,
      },
      domain: partner.metadata?.storefront_domain || null,
      storefront_url: partner.metadata?.storefront_domain
        ? `https://${partner.metadata.storefront_domain}`
        : null,
      provisioned_at: partner.metadata?.storefront_provisioned_at || null,
      latest_deployment: deploymentInfo,
      vercel_configured: deployment.isVercelConfigured(),
      cloudflare_configured: deployment.isCloudflareConfigured(),
    })
  } catch (e: any) {
    // If Vercel returns 404, the project was deleted — treat as not provisioned
    const is404 = e.message?.includes("(404)") || e.message?.includes("NOT_FOUND")
    if (is404) {
      // Clean up stale metadata via workflow
      try {
        await updatePartnerWorkflow(req.scope).run({
          input: {
            id: partner.id,
            data: { metadata: stripStorefrontKeys(partner.metadata) },
          },
        })
      } catch {
        // best-effort cleanup
      }

      return res.json({
        provisioned: false,
        message: "Storefront project no longer exists",
        vercel_configured: deployment.isVercelConfigured(),
        cloudflare_configured: deployment.isCloudflareConfigured(),
      })
    }

    res.json({
      provisioned: true,
      project: {
        id: vercelProjectId,
        name: partner.metadata?.vercel_project_name || null,
      },
      domain: partner.metadata?.storefront_domain || null,
      storefront_url: partner.metadata?.storefront_domain
        ? `https://${partner.metadata.storefront_domain}`
        : null,
      provisioned_at: partner.metadata?.storefront_provisioned_at || null,
      latest_deployment: null,
      error: `Could not fetch Vercel status: ${e.message}`,
      vercel_configured: deployment.isVercelConfigured(),
      cloudflare_configured: deployment.isCloudflareConfigured(),
    })
  }
}

/**
 * DELETE /partners/storefront
 * Remove the Vercel project, Cloudflare DNS, and clear storefront metadata.
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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const vercelProjectId = partner.metadata?.vercel_project_id
  const storefrontDomain = partner.metadata?.storefront_domain

  if (!vercelProjectId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const results: Record<string, any> = {}

  // Remove Vercel project
  if (deployment.isVercelConfigured()) {
    try {
      if (storefrontDomain) {
        try {
          await deployment.removeDomain(vercelProjectId, storefrontDomain)
          results.vercel_domain = { action: "removed" }
        } catch (e: any) {
          results.vercel_domain = { action: "failed", error: e.message }
        }
      }

      await deployment.deleteProject(vercelProjectId)
      results.vercel_project = { action: "deleted" }
    } catch (e: any) {
      results.vercel_project = { action: "failed", error: e.message }
    }
  } else {
    results.vercel_project = { action: "skipped", reason: "Vercel not configured" }
  }

  // Remove Cloudflare DNS record
  if (storefrontDomain) {
    results.dns = await deployment.removeStorefrontDns(storefrontDomain)
  } else {
    results.dns = { action: "skipped", reason: "No domain" }
  }

  // Clear storefront metadata via the update workflow (ensures proper DB write)
  const cleanMetadata = stripStorefrontKeys(partner.metadata)

  await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: { metadata: cleanMetadata },
    },
  })

  results.metadata = { action: "cleared" }

  res.json({
    message: "Storefront removed",
    results,
  })
}
