import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawPartner = {
  workspace_type: "seller" | "manufacturer" | "individual"
  vercel_linked: boolean
}

type RawWebsite = {
  id: string
  domain: string
  status: string
}

// GMV projection — conservative throughput baseline. Per-brand/per-artisan
// monthly revenue floor expressed in the website's currency (INR for
// jaalyantra, USD for kindhealth). Tuned for "defensible run-rate" framing
// rather than aspirational ceiling.
const PROJECTION_PER_BRAND_MONTHLY: Record<string, number> = {
  INR: 100_000,
  USD: 1_200,
  EUR: 1_100,
}
const PROJECTION_PER_ARTISAN_MONTHLY: Record<string, number> = {
  INR: 5_000,
  USD: 60,
  EUR: 55,
}
const DEFAULT_CURRENCY_BY_TLD: Record<string, string> = {
  "jaalyantra.com": "INR",
  "kindhealth.com": "USD",
}
const PROJECTION_WINDOW_DAYS = 90

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { domain } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Pull partners + websites in parallel. We use website rows (not partner
  // flags) for brands_live since storefront sites are seeded there and the
  // partner-side vercel_linked flag isn't reliably populated yet.
  const [partnersRes, websitesRes] = await Promise.all([
    query.graph({
      entity: "partners",
      fields: ["workspace_type", "vercel_linked"],
      filters: { status: "active" },
      pagination: { take: 1000 },
    }),
    query.graph({
      entity: "websites",
      fields: ["id", "domain", "status"],
      filters: { status: "Active" },
      pagination: { take: 200 },
    }),
  ])

  let artisans = 0
  for (const p of (partnersRes.data || []) as unknown as RawPartner[]) {
    if (p.workspace_type === "individual" || p.workspace_type === "manufacturer") {
      artisans++
    }
  }

  // brands_live = active brand storefronts. Exclude the platform's own
  // marketing site (matches the :domain in the URL or any known platform
  // host) so the number reflects ateliers, not us.
  const platformHosts = new Set<string>([
    domain.toLowerCase(),
    "jaalyantra.com",
    "kindhealth.com",
    "www.jaalyantra.com",
    "www.kindhealth.com",
  ])
  const sites = (websitesRes.data || []) as unknown as RawWebsite[]
  const brandsLive = sites.filter((w) => !platformHosts.has(w.domain.toLowerCase())).length

  const currency = DEFAULT_CURRENCY_BY_TLD[domain.toLowerCase()] || "USD"
  const perBrand = PROJECTION_PER_BRAND_MONTHLY[currency] ?? PROJECTION_PER_BRAND_MONTHLY.USD
  const perArtisan = PROJECTION_PER_ARTISAN_MONTHLY[currency] ?? PROJECTION_PER_ARTISAN_MONTHLY.USD
  const months = PROJECTION_WINDOW_DAYS / 30
  const projected = Math.round(brandsLive * perBrand * months + artisans * perArtisan * months)

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({
    artisans,
    brands_live: brandsLive,
    hubs: 3,
    gmv: {
      amount: projected,
      currency,
      window_days: PROJECTION_WINDOW_DAYS,
      source: "projected",
      formula: {
        per_brand_monthly: perBrand,
        per_artisan_monthly: perArtisan,
      },
    },
    last_updated: new Date().toISOString(),
  })
}
