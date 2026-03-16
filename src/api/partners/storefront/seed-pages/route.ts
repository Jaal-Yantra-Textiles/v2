import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { getPartnerWebsite } from "../helpers"
import { seedDefaultPagesWorkflow } from "../../../../workflows/website/seed-default-pages"

/**
 * POST /partners/storefront/seed-pages
 * Seed default pages (T&C, Privacy Policy, Contact) for the partner's website.
 * Skips pages that already exist (idempotent).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { website } = await getPartnerWebsite(req.auth_context, req.scope)

  const { result } = await seedDefaultPagesWorkflow(req.scope).run({
    input: { website_id: website.id },
  })

  res.status(201).json({
    message: `Seeded ${result.pages.length} pages, skipped ${result.skipped.length} existing`,
    pages: result.pages,
    skipped: result.skipped,
  })
}
