import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawPartner = {
  id: string
  name: string
  handle: string
  logo: string | null
  workspace_type: "seller" | "manufacturer" | "individual"
  storefront_domain: string | null
  vercel_linked: boolean
  metadata: Record<string, unknown> | null
}

type PublicPartner = {
  id: string
  name: string
  handle: string
  logo: string | null
  craft: string | null
  location: string | null
  story: string | null
}

type PublicBrand = PublicPartner & {
  storefront_url: string
  is_live: boolean
}

const ARTISAN_LIMIT = 6
const BRAND_LIMIT = 6

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // One query, split by workspace_type in memory. Cheaper than two roundtrips
  // and keeps response logic together.
  const { data } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "handle",
      "logo",
      "workspace_type",
      "storefront_domain",
      "vercel_linked",
      "metadata",
    ],
    filters: { status: "active" },
    pagination: { take: 100 },
  })

  const partners = (data || []) as unknown as RawPartner[]

  const artisans: PublicPartner[] = []
  const brands: PublicBrand[] = []

  for (const p of partners) {
    const meta = (p.metadata || {}) as Record<string, unknown>
    const logo = p.logo ?? (typeof meta.logo === "string" ? meta.logo : null)
    const base: PublicPartner = {
      id: p.id,
      name: p.name,
      handle: p.handle,
      logo,
      craft: typeof meta.craft === "string" ? meta.craft : null,
      location: typeof meta.location === "string" ? meta.location : null,
      story: typeof meta.story === "string" ? meta.story : null,
    }

    if (p.workspace_type === "individual" || p.workspace_type === "manufacturer") {
      if (artisans.length < ARTISAN_LIMIT) artisans.push(base)
    } else if (p.workspace_type === "seller" && p.vercel_linked) {
      if (brands.length < BRAND_LIMIT) {
        brands.push({
          ...base,
          storefront_url: p.storefront_domain
            ? `https://${p.storefront_domain}`
            : `/storefront/${p.handle}`,
          is_live: true,
        })
      }
    }
  }

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({ artisans, brands })
}
