import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawWebsite = {
  id: string
  domain: string
  name: string
  description: string | null
  favicon_url: string | null
}

type PublicWebsite = {
  id: string
  domain: string
  name: string
  description: string | null
  favicon_url: string | null
  url: string
}

const LIMIT = 24

// Public list of active websites — the "ateliers powered" rail in jyt-web
// footer + the cross-brand strip in the consumer view. We don't gate by the
// :domain in the URL today (every brand can see every other brand); the
// param stays for parity with sibling marketing endpoints and so the front
// end can attach cache/auth headers consistently.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // query.graph expects the pluralized entity name (matches the working
  // marketing/partners endpoint convention).
  const { data } = await query.graph({
    entity: "websites",
    fields: ["id", "domain", "name", "description", "favicon_url"],
    filters: { status: "Active" },
    pagination: { take: LIMIT, order: { name: "ASC" } },
  })

  const websites: PublicWebsite[] = ((data || []) as unknown as RawWebsite[]).map((w) => ({
    id: w.id,
    domain: w.domain,
    name: w.name,
    description: w.description,
    favicon_url: w.favicon_url,
    url: w.domain.startsWith("http") ? w.domain : `https://${w.domain}`,
  }))

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=900")
  res.status(200).json({ websites })
}
