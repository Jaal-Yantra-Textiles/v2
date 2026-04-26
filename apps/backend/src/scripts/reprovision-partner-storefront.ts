import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { provisionStorefrontWorkflow } from "../workflows/stores/provision-storefront"
import { DEPLOYMENT_MODULE } from "../modules/deployment"
import type DeploymentService from "../modules/deployment/service"
import type PartnerService from "../modules/partner/service"

/**
 * Reprovision a single partner's storefront. Mirrors the admin provision
 * route logic, minus the HTTP layer — for one-off recoveries (stale Vercel
 * project, wrong team, etc.) when you'd rather not juggle admin auth.
 *
 * Run:
 *   PARTNER_ID=<id> npx medusa exec ./src/scripts/reprovision-partner-storefront.ts
 *
 * Env:
 *   PARTNER_ID                       required
 *   ROOT_DOMAIN                      default: cicilabel.com
 *   VERCEL_STOREFRONT_REPO           required (or partner.storefront_repo)
 *   VERCEL_STOREFRONT_ROOT_DIR       optional
 *   VERCEL_STOREFRONT_BRANCH         optional (default: main)
 *   MEDUSA_BACKEND_URL               required
 */
export default async function reprovisionPartnerStorefront({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const partnerService = container.resolve<PartnerService>("partner")
  const deployment = container.resolve<DeploymentService>(DEPLOYMENT_MODULE)

  const partnerId = process.env.PARTNER_ID
  if (!partnerId) {
    logger.error("PARTNER_ID env is required")
    return
  }

  const rootDomain = process.env.ROOT_DOMAIN || "cicilabel.com"
  const storefrontRepoEnv = process.env.VERCEL_STOREFRONT_REPO || ""
  const storefrontRootDirEnv = process.env.VERCEL_STOREFRONT_ROOT_DIR || ""
  const storefrontBranchEnv = process.env.VERCEL_STOREFRONT_BRANCH || "main"
  const medusaBackendUrl =
    process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
  const stripeKey = process.env.NEXT_PUBLIC_STRIPE_KEY || ""

  // S3 image config (matches provision route)
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

  // Pull partner with stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["*", "stores.*"],
    filters: { id: partnerId },
  })
  const partner = (partners?.[0] as any) || null
  if (!partner) {
    logger.error(`Partner ${partnerId} not found`)
    return
  }

  const stores = partner.stores || []
  if (!stores.length) {
    logger.error(`Partner ${partnerId} has no store — create one first`)
    return
  }
  const salesChannelId = stores[0].default_sales_channel_id
  if (!salesChannelId) {
    logger.error(`Partner ${partnerId} store has no default sales channel`)
    return
  }

  // Find publishable API key for the sales channel
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { type: "publishable" },
  })
  const matchingKey = (apiKeys || []).find((key: any) =>
    (key.sales_channels || []).some((sc: any) => sc.id === salesChannelId)
  )
  if (!matchingKey) {
    logger.error(`No publishable API key linked to sales channel ${salesChannelId}`)
    return
  }

  // Guard against an already-live Vercel project
  const existingProjectId =
    partner.vercel_project_id || partner.metadata?.vercel_project_id
  if (existingProjectId && deployment.isVercelConfigured()) {
    try {
      await deployment.getProject(existingProjectId)
      logger.error(
        `Partner ${partnerId} already has a live Vercel project ${existingProjectId}. Clear it first or use redeploy.`
      )
      return
    } catch {
      logger.info(
        `Stale Vercel project ref ${existingProjectId} — will be overwritten by the provision workflow`
      )
    }
  }

  const rawHandle =
    partner.handle || partner.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const handle = rawHandle
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")

  const storefrontRepo = partner.storefront_repo || storefrontRepoEnv
  const storefrontRootDir =
    partner.storefront_root_dir || storefrontRootDirEnv || undefined
  const storefrontBranch = partner.storefront_branch || storefrontBranchEnv

  if (!storefrontRepo) {
    logger.error(
      "No storefront repo (partner.storefront_repo or VERCEL_STOREFRONT_REPO)"
    )
    return
  }

  logger.info(
    `[reprovision] partner=${partnerId} handle=${handle} repo=${storefrontRepo} branch=${storefrontBranch} rootDir=${storefrontRootDir || "<root>"}`
  )

  const { result } = await provisionStorefrontWorkflow(container).run({
    input: {
      partner_id: partnerId,
      partner_name: partner.name,
      handle,
      publishable_key: matchingKey.token,
      root_domain: rootDomain,
      storefront_repo: storefrontRepo,
      storefront_root_dir: storefrontRootDir,
      storefront_branch: storefrontBranch,
      medusa_backend_url: medusaBackendUrl,
      stripe_publishable_key: stripeKey,
      s3_hostname: s3Hostname,
      s3_pathname: s3Pathname,
    },
  })

  logger.info(
    `[reprovision] done — project=${(result as any)?.project?.id} deployment=${(result as any)?.deployment?.id} url=https://${handle}.${rootDomain}`
  )
}
