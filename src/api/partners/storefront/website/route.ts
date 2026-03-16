import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { WEBSITE_MODULE } from "../../../../modules/website"
import WebsiteService from "../../../../modules/website/service"
import { createWebsiteWorkflow } from "../../../../workflows/website/create-website"
import { seedDefaultPagesWorkflow } from "../../../../workflows/website/seed-default-pages"
import updatePartnerWorkflow from "../../../../workflows/partners/update-partner"

/**
 * POST /partners/storefront/website
 * Auto-create a website for the partner's storefront domain.
 * Seeds default pages (T&C, Privacy Policy, Contact) automatically.
 * Stores website_id on the partner record (table column, not metadata).
 */
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

  const domain = partner.storefront_domain || partner.metadata?.storefront_domain
  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned. Please provision your storefront first."
    )
  }

  // Already has a website_id linked
  const existingWebsiteId = partner.website_id || partner.metadata?.website_id
  if (existingWebsiteId) {
    const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
    try {
      const existing = await websiteService.retrieveWebsite(existingWebsiteId)
      return res.json({
        message: "Website already exists",
        website: existing,
      })
    } catch {
      // stale, continue to create
    }
  }

  // Create a fresh website for this partner's domain
  const { result: website } = await createWebsiteWorkflow(req.scope).run({
    input: {
      domain,
      name: partner.name || domain,
      status: "Active",
    },
  })

  // Store website_id on the partner record (table column)
  await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: { website_id: website.id },
    },
  })

  // Seed default pages
  const { result: seedResult } = await seedDefaultPagesWorkflow(req.scope).run({
    input: { website_id: website.id },
  })

  res.status(201).json({
    message: "Website created with default pages",
    website,
    seeded_pages: seedResult.pages,
  })
}

/**
 * GET /partners/storefront/website
 * Get the partner's website. Uses table columns first, falls back to domain lookup.
 */
export const GET = async (
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

  const domain = partner.storefront_domain || partner.metadata?.storefront_domain
  if (!domain) {
    return res.json({ website: null, message: "Storefront not provisioned" })
  }

  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)

  // 1. Direct lookup by website_id (table column or metadata fallback)
  const websiteId = partner.website_id || partner.metadata?.website_id
  if (websiteId) {
    try {
      const website = await websiteService.retrieveWebsite(websiteId)
      return res.json({ website })
    } catch {
      // stale id, fall through to domain
    }
  }

  // 2. Fallback: lookup by storefront_domain
  const [websites] = await websiteService.listAndCountWebsites(
    { domain },
    { take: 1 }
  )

  if (websites.length) {
    // Backfill website_id on partner for next time
    try {
      await updatePartnerWorkflow(req.scope).run({
        input: {
          id: partner.id,
          data: { website_id: websites[0].id },
        },
      })
    } catch {
      // best-effort backfill
    }
    return res.json({ website: websites[0] })
  }

  return res.json({
    website: null,
    message: "No website found. Create one from the Content section.",
  })
}
