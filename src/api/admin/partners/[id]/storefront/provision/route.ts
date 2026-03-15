import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { provisionStorefrontWorkflow } from "../../../../../../workflows/stores/provision-storefront"
import { DEPLOYMENT_MODULE } from "../../../../../../modules/deployment"
import type DeploymentService from "../../../../../../modules/deployment/service"
import updatePartnerWorkflow from "../../../../../../workflows/partners/update-partner"

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "cicilabel.com"
const STOREFRONT_REPO = process.env.VERCEL_STOREFRONT_REPO || ""
const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY || ""

function getS3ImageConfig(): { hostname: string; pathname: string } {
  const fileUrl = process.env.S3_FILE_URL || ""
  const prefix = process.env.S3_PREFIX || ""
  let hostname = process.env.MEDUSA_CLOUD_S3_HOSTNAME || ""
  let pathname = process.env.MEDUSA_CLOUD_S3_PATHNAME || ""
  if (!hostname && fileUrl) {
    try { hostname = new URL(fileUrl).hostname } catch {}
  }
  if (!pathname && prefix) {
    pathname = `/${prefix.replace(/^\//, "")}**`
  }
  return { hostname, pathname }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params

  if (!STOREFRONT_REPO) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "VERCEL_STOREFRONT_REPO environment variable is not configured"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Fetch partner with stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["*", "stores.*"],
    filters: { id: partnerId },
  })

  if (!partners?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${partnerId} not found`)
  }

  const partner = partners[0] as any
  const stores = partner.stores || []

  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner has no store. Create a store first via POST /partners/stores"
    )
  }

  const store = stores[0]
  const salesChannelId = store.default_sales_channel_id

  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Store has no default sales channel"
    )
  }

  // Check if already provisioned — verify the project actually exists on Vercel
  if (partner.metadata?.vercel_project_id) {
    let projectExists = false
    const deploymentSvc: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
    if (deploymentSvc.isVercelConfigured()) {
      try {
        await deploymentSvc.getProject(partner.metadata.vercel_project_id)
        projectExists = true
      } catch {
        projectExists = false
      }
    }

    if (projectExists) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Storefront already provisioned (Vercel project: ${partner.metadata.vercel_project_id}). Use the redeploy endpoint to update.`
      )
    }

    // Stale metadata — clean it up before re-provisioning
    const currentMeta = (partner.metadata || {}) as Record<string, any>
    const cleanMeta: Record<string, any> = {}
    for (const [k, v] of Object.entries(currentMeta)) {
      if (!["vercel_project_id", "vercel_project_name", "storefront_domain", "storefront_provisioned_at"].includes(k)) {
        cleanMeta[k] = v
      }
    }
    await updatePartnerWorkflow(req.scope).run({
      input: {
        id: partnerId,
        data: { metadata: Object.keys(cleanMeta).length > 0 ? cleanMeta : null },
      },
    })
    partner.metadata = cleanMeta
  }

  // 2. Find publishable API key linked to this sales channel
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { type: "publishable" },
  })

  const matchingKey = (apiKeys || []).find((key: any) => {
    const keySalesChannels = key.sales_channels || []
    return keySalesChannels.some((sc: any) => sc.id === salesChannelId)
  })

  if (!matchingKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No publishable API key found for this partner's sales channel"
    )
  }

  const rawHandle = partner.handle || partner.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const handle = rawHandle
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")

  const s3Config = getS3ImageConfig()

  const { result } = await provisionStorefrontWorkflow(req.scope).run({
    input: {
      partner_id: partnerId,
      handle,
      publishable_key: matchingKey.token,
      root_domain: ROOT_DOMAIN,
      storefront_repo: STOREFRONT_REPO,
      medusa_backend_url: MEDUSA_BACKEND_URL,
      stripe_publishable_key: STRIPE_PUBLISHABLE_KEY,
      s3_hostname: s3Config.hostname,
      s3_pathname: s3Config.pathname,
      existing_metadata: partner.metadata || {},
    },
  })

  res.status(201).json({
    message: "Storefront provisioned successfully",
    ...result,
    storefront_url: `https://${handle}.${ROOT_DOMAIN}`,
  })
}
