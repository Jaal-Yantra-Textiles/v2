import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { getProject, getDeployment } from "../../../lib/vercel"

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
    return res.json({
      provisioned: false,
      message: "Storefront has not been provisioned yet",
    })
  }

  try {
    const project = await getProject(vercelProjectId)
    const latestDeployment = project.latestDeployments?.[0]

    let deploymentInfo: {
      id: string
      url: string
      status: string
      created_at: number
    } | null = null

    if (latestDeployment) {
      try {
        const details = await getDeployment(latestDeployment.id)
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
    })
  } catch (e: any) {
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
    })
  }
}
