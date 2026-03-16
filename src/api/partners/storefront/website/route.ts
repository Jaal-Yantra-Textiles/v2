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

/**
 * POST /partners/storefront/website
 * Auto-create a website for the partner's storefront domain.
 * Seeds default pages (T&C, Privacy Policy, Contact) automatically.
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

  const domain = partner.metadata?.storefront_domain
  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned. Please provision your storefront first."
    )
  }

  // Check if website already exists for this domain
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
  const [existing] = await websiteService.listAndCountWebsites(
    { domain },
    { take: 1 }
  )

  if (existing.length) {
    return res.json({
      message: "Website already exists for this domain",
      website: existing[0],
    })
  }

  // Create the website
  const { result: website } = await createWebsiteWorkflow(req.scope).run({
    input: {
      domain,
      name: partner.name || domain,
      status: "Active",
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
 * Get the partner's website info.
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

  const domain = partner.metadata?.storefront_domain
  if (!domain) {
    return res.json({ website: null, message: "Storefront not provisioned" })
  }

  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
  const [websites] = await websiteService.listAndCountWebsites(
    { domain },
    { relations: ["pages"], take: 1 }
  )

  if (!websites.length) {
    return res.json({
      website: null,
      message: "No website found. Create one via POST /partners/storefront/website.",
    })
  }

  res.json({ website: websites[0] })
}
