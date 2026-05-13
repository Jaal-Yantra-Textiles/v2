import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../../../../modules/deployment"
import type DeploymentService from "../../../../../modules/deployment/service"
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

  if (!refs.vercelProjectId) {
    return res.json({
      provisioned: false,
      message: "Storefront has not been provisioned yet",
    })
  }

  try {
    const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
    const project = await deployment.getProject(refs.vercelProjectId)
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
      error: `Could not fetch Vercel status: ${e.message}`,
    })
  }
}
