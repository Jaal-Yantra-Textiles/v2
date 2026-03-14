import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { provisionStorefrontWorkflow } from "../../../../../../workflows/stores/provision-storefront"

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "cicilabel.com"
const STOREFRONT_REPO = process.env.VERCEL_STOREFRONT_REPO || ""
const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY || ""

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

  // Check if already provisioned
  if (partner.metadata?.vercel_project_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Storefront already provisioned (Vercel project: ${partner.metadata.vercel_project_id}). Use the redeploy endpoint to update.`
    )
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

  const { result } = await provisionStorefrontWorkflow(req.scope).run({
    input: {
      partner_id: partnerId,
      handle,
      publishable_key: matchingKey.token,
      root_domain: ROOT_DOMAIN,
      storefront_repo: STOREFRONT_REPO,
      medusa_backend_url: MEDUSA_BACKEND_URL,
      stripe_publishable_key: STRIPE_PUBLISHABLE_KEY,
      existing_metadata: partner.metadata || {},
    },
  })

  res.status(201).json({
    message: "Storefront provisioned successfully",
    ...result,
    storefront_url: `https://${handle}.${ROOT_DOMAIN}`,
  })
}
