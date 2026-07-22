import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { WEBSITE_MODULE } from "../../../../../modules/website"
import WebsiteService from "../../../../../modules/website/service"
import { updateWebsiteWorkflow } from "../../../../../workflows/website/update-website"

const ALLOWED_PROVIDERS = new Set(["in_house", "custom", "off"])

type AnalyticsView = {
  website_id: string
  domain: string
  provider: "in_house" | "custom" | "off"
  custom_head: string | null
  custom_body_end: string | null
  // SEO (not analytics) — shares this storefront-<head>-settings surface (#349).
  // Google Search Console verification token; the storefront always injects it
  // as <meta name="google-site-verification"> regardless of analytics provider.
  google_site_verification: string | null
}

function shape(website: any): AnalyticsView {
  return {
    website_id: website.id,
    domain: website.domain,
    provider: website.analytics_provider ?? "in_house",
    custom_head: website.analytics_custom_head ?? null,
    custom_body_end: website.analytics_custom_body_end ?? null,
    google_site_verification: website.google_site_verification ?? null,
  }
}

async function resolveWebsiteForPartner(
  partner: { id: string; website_id?: string | null; storefront_domain?: string | null; metadata?: Record<string, any> | null },
  websiteService: WebsiteService,
) {
  const websiteId =
    partner.website_id || (partner.metadata?.website_id as string | undefined)
  if (websiteId) {
    try {
      return await websiteService.retrieveWebsite(websiteId)
    } catch {
      // fall through to domain lookup
    }
  }

  const domain =
    partner.storefront_domain ||
    (partner.metadata?.storefront_domain as string | undefined)
  if (!domain) return null

  const [websites] = await websiteService.listAndCountWebsites(
    { domain },
    { take: 1 },
  )
  return websites[0] ?? null
}

/**
 * GET /partners/storefront/website/analytics
 * Returns the analytics provider + custom-script blocks for the
 * partner's website.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const partner = (await getPartnerFromAuthContext(
    req.auth_context,
    req.scope,
  )) as any
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account",
    )
  }

  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
  const website = await resolveWebsiteForPartner(partner, websiteService)
  if (!website) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No website is linked to this partner yet. Provision your storefront first.",
    )
  }

  res.json({ analytics: shape(website) })
}

/**
 * PUT /partners/storefront/website/analytics
 * Updates the analytics settings for the partner's website. Body fields:
 *   provider:        "in_house" | "custom" | "off"
 *   custom_head:     string | null   (raw HTML/script block)
 *   custom_body_end: string | null   (raw HTML/script block)
 *
 * Each field is independently optional so the UI can patch one at a time.
 */
export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const partner = (await getPartnerFromAuthContext(
    req.auth_context,
    req.scope,
  )) as any
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account",
    )
  }

  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)
  const website = await resolveWebsiteForPartner(partner, websiteService)
  if (!website) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No website is linked to this partner yet. Provision your storefront first.",
    )
  }

  const body = (req.body || {}) as Record<string, any>

  const update: Record<string, any> = { id: website.id }

  if (body.provider !== undefined) {
    if (!ALLOWED_PROVIDERS.has(body.provider)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `provider must be one of: in_house, custom, off`,
      )
    }
    update.analytics_provider = body.provider
  }

  if (body.custom_head !== undefined) {
    if (body.custom_head !== null && typeof body.custom_head !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "custom_head must be a string or null",
      )
    }
    update.analytics_custom_head = body.custom_head
  }

  if (body.custom_body_end !== undefined) {
    if (body.custom_body_end !== null && typeof body.custom_body_end !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "custom_body_end must be a string or null",
      )
    }
    update.analytics_custom_body_end = body.custom_body_end
  }

  if (body.google_site_verification !== undefined) {
    if (
      body.google_site_verification !== null &&
      typeof body.google_site_verification !== "string"
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "google_site_verification must be a string or null",
      )
    }
    // Collapse empty/whitespace to null so "cleared" is distinct from a token.
    const token =
      typeof body.google_site_verification === "string"
        ? body.google_site_verification.trim()
        : body.google_site_verification
    update.google_site_verification = token ? token : null
  }

  // Nothing to apply — return the current view.
  if (Object.keys(update).length === 1) {
    return res.json({ analytics: shape(website) })
  }

  await updateWebsiteWorkflow(req.scope).run({ input: update as any })

  // Re-fetch so the response reflects DB state, not the input echo.
  const refreshed = await websiteService.retrieveWebsite(website.id)
  res.json({ analytics: shape(refreshed) })
}
