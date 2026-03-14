import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { provisionStorefrontWorkflow } from "../../../../workflows/stores/provision-storefront"
import { getProject, isVercelConfigured } from "../../../../lib/vercel"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "cicilabel.com"
const STOREFRONT_REPO = process.env.VERCEL_STOREFRONT_REPO || ""
const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY || ""

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

  if (!STOREFRONT_REPO) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "VERCEL_STOREFRONT_REPO environment variable is not configured"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch partner with stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["*", "stores.*"],
    filters: { id: partner.id },
  })

  const partnerData = partners?.[0] as any
  const stores = partnerData?.stores || []

  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "You have no store. Create a store first."
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
  if (partnerData.metadata?.vercel_project_id) {
    let projectExists = false
    if (isVercelConfigured()) {
      try {
        await getProject(partnerData.metadata.vercel_project_id)
        projectExists = true
      } catch {
        // Project doesn't exist on Vercel (404) — clear stale metadata and allow re-provisioning
        projectExists = false
      }
    }

    if (projectExists) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Storefront already provisioned. Use redeploy to update."
      )
    }

    // Stale metadata — clean it up before re-provisioning
    const currentMeta = (partnerData.metadata || {}) as Record<string, any>
    const cleanMeta: Record<string, any> = {}
    for (const [k, v] of Object.entries(currentMeta)) {
      if (!["vercel_project_id", "vercel_project_name", "storefront_domain", "storefront_provisioned_at"].includes(k)) {
        cleanMeta[k] = v
      }
    }
    await updatePartnerWorkflow(req.scope).run({
      input: {
        id: partner.id,
        data: { metadata: Object.keys(cleanMeta).length > 0 ? cleanMeta : null },
      },
    })
    // Update partnerData.metadata for the workflow below
    partnerData.metadata = cleanMeta
  }

  // Find publishable API key linked to this sales channel
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
      "No publishable API key found for your sales channel"
    )
  }

  const rawHandle =
    partnerData.handle ||
    partnerData.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const handle = rawHandle
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")

  const { result } = await provisionStorefrontWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      handle,
      publishable_key: matchingKey.token,
      root_domain: ROOT_DOMAIN,
      storefront_repo: STOREFRONT_REPO,
      medusa_backend_url: MEDUSA_BACKEND_URL,
      stripe_publishable_key: STRIPE_PUBLISHABLE_KEY,
      existing_metadata: partnerData.metadata || {},
    },
  })

  res.status(201).json({
    message: "Storefront provisioned successfully",
    ...result,
    storefront_url: `https://${handle}.${ROOT_DOMAIN}`,
  })
}
