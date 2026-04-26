import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { WEBSITE_MODULE } from "../../../../../modules/website"
import WebsiteService from "../../../../../modules/website/service"

function normalizeDomain(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
}

/**
 * GET /admin/websites/:id/domains
 * List every domain (primary + aliases) that resolves to this website.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)

  const [rows] = await (websiteService as any).listAndCountWebsiteDomains(
    { website_id: id },
    { take: 1000, order: { is_primary: "DESC", created_at: "ASC" } }
  )

  res.json({ domains: rows || [] })
}

/**
 * POST /admin/websites/:id/domains
 * Add an alias domain that resolves to this website.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const domain = normalizeDomain((req.body as any)?.domain)

  if (!domain || domain.length < 3 || !domain.includes(".")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Please provide a valid domain (e.g. shop.example.com)"
    )
  }

  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)

  // Confirm the website exists first (404 bubbles up to caller)
  await websiteService.retrieveWebsite(id)

  const [existing] = await (websiteService as any).listAndCountWebsiteDomains(
    { domain },
    { take: 1 }
  )
  if (existing?.length) {
    const row = existing[0]
    if (row.website_id !== id) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Domain ${domain} is already registered to another website`
      )
    }
    return res.status(200).json({ domain: row, created: false })
  }

  const created = await (websiteService as any).createWebsiteDomains({
    domain,
    is_primary: false,
    website_id: id,
  })

  res.status(201).json({ domain: created, created: true })
}
