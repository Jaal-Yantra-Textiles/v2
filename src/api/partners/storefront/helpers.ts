import { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { WEBSITE_MODULE } from "../../../modules/website"
import WebsiteService from "../../../modules/website/service"

/**
 * Gets the partner's website using the website_id stored in metadata.
 * Falls back to domain lookup only if website_id is not set.
 * This ensures each partner only ever sees their own website.
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

  const websiteId = partner.metadata?.website_id
  const domain = partner.metadata?.storefront_domain

  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned. Please provision your storefront first."
    )
  }

  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

  // Primary: lookup by stored website_id (direct link, no ambiguity)
  if (websiteId) {
    try {
      const website = await websiteService.retrieveWebsite(websiteId)
      if (website) {
        return { partner, website }
      }
    } catch {
      // stale website_id, fall through to domain lookup
    }
  }

  // Fallback: lookup by partner's storefront domain
  const [websites] = await websiteService.listAndCountWebsites(
    { domain },
    { take: 1 }
  )

  if (!websites.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No website found. Create one first from the Content section.`
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
