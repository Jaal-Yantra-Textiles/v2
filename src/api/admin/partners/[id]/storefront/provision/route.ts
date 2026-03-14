import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createProject,
  setEnvironmentVariables,
  addDomain,
  triggerDeployment,
} from "../../../../../../lib/vercel"

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

  const handle = partner.handle || partner.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const projectName = `storefront-${handle}`
  const domain = `${handle}.${ROOT_DOMAIN}`

  // 3. Create Vercel project
  const project = await createProject({
    name: projectName,
    gitRepo: STOREFRONT_REPO,
    framework: "nextjs",
  })

  // 4. Set environment variables
  await setEnvironmentVariables(project.id, [
    {
      key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
      value: matchingKey.token,
      type: "plain",
      target: ["production", "preview"],
    },
    {
      key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
      value: MEDUSA_BACKEND_URL,
      type: "plain",
      target: ["production", "preview"],
    },
    {
      key: "MEDUSA_BACKEND_URL",
      value: MEDUSA_BACKEND_URL,
      type: "plain",
      target: ["production", "preview"],
    },
    {
      key: "NEXT_PUBLIC_STRIPE_KEY",
      value: STRIPE_PUBLISHABLE_KEY,
      type: "plain",
      target: ["production", "preview"],
    },
  ])

  // 5. Add custom domain
  let domainResult
  try {
    domainResult = await addDomain(project.id, domain)
  } catch (e: any) {
    // Domain assignment can fail if DNS isn't ready — non-fatal
    domainResult = { name: domain, verified: false, error: e.message }
  }

  // 6. Trigger production deployment
  const deployment = await triggerDeployment({
    projectName,
    gitRepo: STOREFRONT_REPO,
    ref: "main",
  })

  // 7. Save Vercel project ID to partner metadata
  const partnerService = req.scope.resolve("partner")
  await partnerService.updatePartners({
    id: partnerId,
    metadata: {
      ...(partner.metadata || {}),
      vercel_project_id: project.id,
      vercel_project_name: projectName,
      storefront_domain: domain,
      storefront_provisioned_at: new Date().toISOString(),
    },
  })

  res.status(201).json({
    message: "Storefront provisioned successfully",
    project: {
      id: project.id,
      name: projectName,
    },
    domain: domainResult,
    deployment: {
      id: deployment.id,
      url: deployment.url,
      status: deployment.readyState,
    },
    storefront_url: `https://${domain}`,
  })
}
