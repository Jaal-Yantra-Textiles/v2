import { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { WEBSITE_MODULE } from "../../../modules/website"
import WebsiteService from "../../../modules/website/service"

/**
 * Storefront identifiers live on dedicated partner columns now
 * (vercel_project_id, vercel_project_name, storefront_domain,
 * vercel_last_deployment_id). Older records still hold them in
 * partner.metadata. Always read via this helper so the fallback is
 * consistent across every route and we can't accidentally miss a
 * provisioned partner because the read side only checked metadata.
 */
export type StorefrontRefs = {
  vercelProjectId: string | null
  vercelProjectName: string | null
  storefrontDomain: string | null
  vercelLastDeploymentId: string | null
  storefrontProvisionedAt: string | null
}

export const getStorefrontRefs = (partner: any): StorefrontRefs => ({
  vercelProjectId:
    partner?.vercel_project_id ?? partner?.metadata?.vercel_project_id ?? null,
  vercelProjectName:
    partner?.vercel_project_name ??
    partner?.metadata?.vercel_project_name ??
    null,
  storefrontDomain:
    partner?.storefront_domain ?? partner?.metadata?.storefront_domain ?? null,
  vercelLastDeploymentId:
    partner?.vercel_last_deployment_id ??
    partner?.metadata?.vercel_last_deployment_id ??
    null,
  // No column for this one — stays metadata-only.
  storefrontProvisionedAt:
    partner?.metadata?.storefront_provisioned_at ?? null,
})

/**
 * Gets the partner's website.
 * Uses table columns first (website_id, storefront_domain), falls back to metadata.
 */
export const getPartnerWebsite = async (
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer
): Promise<{ partner: any; website: any }> => {
  const partner = await getPartnerFromAuthContext(authContext, container)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const domain = partner.storefront_domain || partner.metadata?.storefront_domain
  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned. Please provision your storefront first."
    )
  }

  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

  // 1. Direct lookup by website_id (table column or metadata fallback)
  const websiteId = partner.website_id || partner.metadata?.website_id
  if (websiteId) {
    try {
      const website = await websiteService.retrieveWebsite(websiteId)
      if (website) {
        return { partner, website }
      }
    } catch {
      // stale, fall through
    }
  }

  // 2. Fallback: lookup by storefront_domain
  const [websites] = await websiteService.listAndCountWebsites(
    { domain },
    { take: 1 }
  )

  if (!websites.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No website found. Create one from the Content section."
    )
  }

  return { partner, website: websites[0] }
}

/**
 * Validates that a page belongs to the partner's website.
 */
export const validatePartnerPageOwnership = async (
  authContext: { actor_id?: string | null } | undefined,
  pageId: string,
  container: MedusaContainer
): Promise<{ partner: any; website: any; page: any }> => {
  const { partner, website } = await getPartnerWebsite(authContext, container)

  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
  const page = await websiteService.retrievePage(pageId, {
    relations: ["blocks"],
  })

  if (!page || (page as any).website_id !== website.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Page not found"
    )
  }

  return { partner, website, page }
}

/**
 * Validates that a block belongs to a page owned by the partner.
 */
export const validatePartnerBlockOwnership = async (
  authContext: { actor_id?: string | null } | undefined,
  pageId: string,
  blockId: string,
  container: MedusaContainer
): Promise<{ partner: any; website: any; page: any; block: any }> => {
  const { partner, website, page } = await validatePartnerPageOwnership(
    authContext,
    pageId,
    container
  )

  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
  const block = await websiteService.retrieveBlock(blockId)

  if (!block || (block as any).page_id !== pageId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Block not found"
    )
  }

  return { partner, website, page, block }
}
