import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"

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

    const envVars: Array<{ key: string; value: string; type: "plain"; target: string[] }> = []

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
        envVars.push({
          key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
          value: matchingKey.token,
          type: "plain",
          target: ["production", "preview"],
        })
      }
    }

    // S3 image config for Next.js image optimization
    const fileUrl = process.env.S3_FILE_URL || ""
    const prefix = process.env.S3_PREFIX || ""
    let s3Hostname = process.env.MEDUSA_CLOUD_S3_HOSTNAME || ""
    let s3Pathname = process.env.MEDUSA_CLOUD_S3_PATHNAME || ""
    if (!s3Hostname && fileUrl) {
      try { s3Hostname = new URL(fileUrl).hostname } catch {}
    }
    if (!s3Pathname && prefix) {
      s3Pathname = `/${prefix.replace(/^\//, "")}**`
    }

    if (s3Hostname) {
      envVars.push({
        key: "MEDUSA_CLOUD_S3_HOSTNAME",
        value: s3Hostname,
        type: "plain",
        target: ["production", "preview"],
      })
    }
    if (s3Pathname) {
      envVars.push({
        key: "MEDUSA_CLOUD_S3_PATHNAME",
        value: s3Pathname,
        type: "plain",
        target: ["production", "preview"],
      })
    }

    // Backend URL
    const backendUrl = process.env.MEDUSA_BACKEND_URL || ""
    if (backendUrl) {
      envVars.push(
        { key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL", value: backendUrl, type: "plain", target: ["production", "preview"] },
        { key: "MEDUSA_BACKEND_URL", value: backendUrl, type: "plain", target: ["production", "preview"] },
      )
    }

    // Stripe key
    const stripeKey = process.env.NEXT_PUBLIC_STRIPE_KEY || ""
    if (stripeKey) {
      envVars.push({
        key: "NEXT_PUBLIC_STRIPE_KEY",
        value: stripeKey,
        type: "plain",
        target: ["production", "preview"],
      })
    }

    if (envVars.length) {
      const svc: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
      await svc.setEnvironmentVariables(vercelProjectId, envVars)
    }
  }

  const deploymentSvc: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const deployment = await deploymentSvc.triggerDeployment({
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
