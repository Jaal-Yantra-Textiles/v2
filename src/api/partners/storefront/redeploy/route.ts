import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import {
  triggerDeployment,
  setEnvironmentVariables,
} from "../../../../lib/vercel"

const STOREFRONT_REPO = process.env.VERCEL_STOREFRONT_REPO || ""

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
  const vercelProjectName = partner.metadata?.vercel_project_name

  if (!vercelProjectId || !vercelProjectName) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned yet."
    )
  }

  if (!STOREFRONT_REPO) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "VERCEL_STOREFRONT_REPO environment variable is not configured"
    )
  }

  const body = (req.body || {}) as { update_env?: boolean; ref?: string }

  if (body.update_env) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: partnerWithStores } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.*"],
      filters: { id: partner.id },
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
        await setEnvironmentVariables(vercelProjectId, [
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

  const deployment = await triggerDeployment({
    projectName: vercelProjectName,
    gitRepo: STOREFRONT_REPO,
    ref: body.ref || "main",
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
