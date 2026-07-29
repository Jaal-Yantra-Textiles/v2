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
import { resolvePartnerWebsiteWorkflow } from "../../../../workflows/partners/resolve-partner-website"

type PartnerRecord = {
  id: string
  name: string
  storefront_domain?: string | null
  website_id?: string | null
  vercel_project_id?: string | null
  metadata?: Record<string, any> | null
}

function getStorefrontDomain(partner: PartnerRecord): string | null {
  return partner.storefront_domain || (partner.metadata?.storefront_domain as string) || null
}

function getWebsiteId(partner: PartnerRecord): string | null {
  return partner.website_id || (partner.metadata?.website_id as string) || null
}

/**
 * POST /partners/storefront/website
 * Auto-create a website for the partner's storefront domain.
 * Seeds default pages (T&C, Privacy Policy, Contact) automatically.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope) as PartnerRecord | null
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const domain = getStorefrontDomain(partner)
  if (!domain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned. Please provision your storefront first."
    )
  }

  // Already has a website_id linked
  const existingWebsiteId = getWebsiteId(partner)
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

  // Store website_id on the partner record
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
 *
 * The partner's website. The lookup (website_id first, storefront_domain
 * fallback) lives in `resolvePartnerWebsiteWorkflow` so the admin inspection
 * mirror (`GET /admin/partners/:id/storefront/website`) resolves it identically
 * (#843).
 *
 * What stays here is the WRITE: resolving via the domain fallback means the
 * partner's `website_id` is absent or stale, so it gets backfilled for next
 * time. The mirror is read-only and deliberately skips it.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope) as PartnerRecord | null
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { result: resolution } = await resolvePartnerWebsiteWorkflow(
    req.scope
  ).run({ input: { partner } })

  if (resolution.website && resolution.resolved_by === "domain") {
    try {
      await updatePartnerWorkflow(req.scope).run({
        input: {
          id: partner.id,
          data: { website_id: resolution.website.id },
        },
      })
    } catch {
      // best-effort backfill
    }
  }

  if (!resolution.website) {
    return res.json({ website: null, message: resolution.message })
  }

  return res.json({ website: resolution.website })
}
