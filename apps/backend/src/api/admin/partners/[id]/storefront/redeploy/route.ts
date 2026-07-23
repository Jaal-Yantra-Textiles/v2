import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../../../../../modules/deployment"
import type DeploymentService from "../../../../../../modules/deployment/service"
import PartnerService from "../../../../../../modules/partner/service"
import { partnerIsOnSharedProject } from "../../../../../../modules/deployment/providers/resolve-partner-provider"

const STOREFRONT_REPO_ENV = process.env.VERCEL_STOREFRONT_REPO || ""
const STOREFRONT_BRANCH_ENV = process.env.VERCEL_STOREFRONT_BRANCH || "main"

export const POST = async (
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

  // Shared multi-tenant deployment: never redeploy it or overwrite its env on
  // behalf of a single partner (it serves every tenant; the store is resolved
  // per-request from the Host header). See partners redeploy route.
  if (await partnerIsOnSharedProject(partner, req.scope)) {
    return res.json({
      message:
        "This storefront runs on a shared, centrally-managed deployment — no per-partner redeploy is performed.",
      deployment: { id: "shared", url: "", status: "shared" },
    })
  }

  const vercelProjectId =
    partner.vercel_project_id || partner.metadata?.vercel_project_id
  const vercelProjectName =
    partner.vercel_project_name || partner.metadata?.vercel_project_name
  const storefrontRepo = partner.storefront_repo || STOREFRONT_REPO_ENV
  const storefrontBranch = partner.storefront_branch || STOREFRONT_BRANCH_ENV

  if (!vercelProjectId || !vercelProjectName) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned yet. Use the provision endpoint first."
    )
  }

  if (!storefrontRepo) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No storefront repo configured (partner.storefront_repo or VERCEL_STOREFRONT_REPO)"
    )
  }

  // Optionally update env vars if publishable key has changed
  const body = (req.body || {}) as { update_env?: boolean; ref?: string }

  if (body.update_env) {
    const { data: partnerWithStores } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.*"],
      filters: { id: partnerId },
    })

    const stores = (partnerWithStores?.[0] as any)?.stores || []
    const store = stores[0]
    const salesChannelId = store?.default_sales_channel_id

    if (salesChannelId) {
      const { data: apiKeys } = await query.graph({
        entity: "api_keys",
        fields: ["*", "sales_channels.*"],
        filters: { type: "publishable" },
      })

      const matchingKey = (apiKeys || []).find((key: any) =>
        (key.sales_channels || []).some((sc: any) => sc.id === salesChannelId)
      )

      if (matchingKey) {
        const svc: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
        await svc.setEnvironmentVariables(vercelProjectId, [
          {
            key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
            value: matchingKey.token,
            type: "plain",
            target: ["production", "preview"],
          },
        ])
      }
    }
  }

  const deploySvc: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const deployment = await deploySvc.triggerDeployment({
    projectName: vercelProjectName,
    gitRepo: storefrontRepo,
    ref: body.ref || storefrontBranch,
  })

  const partnerService: PartnerService = req.scope.resolve("partner")
  await partnerService.updatePartners({
    id: partnerId,
    vercel_last_deployment_id: deployment.id,
  })

  res.json({
    message: "Redeployment triggered",
    deployment: {
      id: deployment.id,
      url: deployment.url,
      status: deployment.readyState,
    },
  })
}
