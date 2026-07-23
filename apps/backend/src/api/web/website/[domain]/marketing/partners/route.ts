import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawPartner = {
  id: string
  name: string
  handle: string
  logo: string | null
  workspace_type: "seller" | "manufacturer" | "individual" | "designer"
  storefront_domain: string | null
  custom_domain: string | null
  custom_domain_verified: boolean
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

type DomainAlias = {
  domain: string
  url: string
  verified: boolean
  primary: boolean
}

type PublicBrand = PublicPartner & {
  storefront_url: string
  is_live: boolean
  domains: DomainAlias[]
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
      "custom_domain",
      "custom_domain_verified",
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

    // A partner is a "live brand" when they actually have a provisioned
    // storefront, not based on workspace_type (which is a partner-UI
    // sidebar concept that's defaulted to "manufacturer" on every row).
    const isLiveBrand = p.vercel_linked === true && !!p.storefront_domain

    if (isLiveBrand) {
      if (brands.length < BRAND_LIMIT) {
        // Domain aliases: the cicilabel subdomain is the canonical /
        // always-available host; custom_domain (e.g. ielocraft.in) is an
        // optional verified alias. Prefer the verified custom domain as
        // storefront_url when present so links in marketing UI point at
        // the partner's branded host.
        // Prefer the typed columns; fall back to legacy metadata for any
        // not-yet-migrated row.
        const customDomain =
          (typeof p.custom_domain === "string" && p.custom_domain) ||
          (typeof meta.custom_domain === "string" ? meta.custom_domain : null)
        const customVerified =
          p.custom_domain_verified === true ||
          (!p.custom_domain && meta.custom_domain_verified === true)
        const primaryHost =
          customDomain && customVerified ? customDomain : p.storefront_domain!

        const domains: DomainAlias[] = [
          {
            domain: p.storefront_domain!,
            url: `https://${p.storefront_domain}`,
            verified: true,
            primary: primaryHost === p.storefront_domain,
          },
        ]
        if (customDomain) {
          domains.push({
            domain: customDomain,
            url: `https://${customDomain}`,
            verified: customVerified,
            primary: primaryHost === customDomain,
          })
        }

        brands.push({
          ...base,
          storefront_url: `https://${primaryHost}`,
          is_live: true,
          domains,
        })
      }
    } else if (artisans.length < ARTISAN_LIMIT) {
      artisans.push(base)
    }
  }

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({ artisans, brands })
}
