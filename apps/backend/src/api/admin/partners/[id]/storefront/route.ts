import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../../../../modules/deployment"
import type DeploymentService from "../../../../../modules/deployment/service"
import { resolveHostingProviderForPartner } from "../../../../../modules/deployment/providers/resolve-partner-provider"
import { getStorefrontRefs } from "../../../../partners/storefront/helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["*"],
    filters: { id: partnerId },
  })

  if (!partners?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${partnerId} not found`)
  }

  const partner = partners[0] as any
  const refs = getStorefrontRefs(partner)

  const { providerName, provider, projectRef } =
    await resolveHostingProviderForPartner(partner, req.scope).catch(() => ({
      providerName: "vercel" as const,
      provider: null as any,
      projectRef: null,
    }))

  if (!projectRef) {
    return res.json({
      provisioned: false,
      message: "Storefront has not been provisioned yet",
    })
  }

  try {
    const project = await provider.getProject(projectRef)

    // Vercel exposes latest-deployment detail; other providers don't (yet) —
    // the provider interface's getProject stays minimal, so this richer status
    // is a Vercel-only enhancement.
    let deploymentInfo: {
      id: string
      url: string
      status: string
      created_at: number
    } | null = null

    if (providerName === "vercel") {
      const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
      const full = await deployment.getProject(projectRef)
      const latestDeployment = full.latestDeployments?.[0]
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
    }

    res.json({
      provisioned: true,
      provider: providerName,
      project: {
        id: project.id,
        name: project.name,
      },
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain
        ? `https://${refs.storefrontDomain}`
        : null,
      provisioned_at: refs.storefrontProvisionedAt,
      latest_deployment: deploymentInfo,
    })
  } catch (e: any) {
    res.json({
      provisioned: true,
      provider: providerName,
      project: {
        id: refs.vercelProjectId,
        name: refs.vercelProjectName,
      },
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain
        ? `https://${refs.storefrontDomain}`
        : null,
      provisioned_at: refs.storefrontProvisionedAt,
      latest_deployment: null,
      error: `Could not fetch storefront status: ${e.message}`,
    })
  }
}
