import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type RawPartner = {
  vercel_linked: boolean
  storefront_domain: string | null
}

type RawWebsite = {
  id: string
  domain: string
  status: string
}

type RawStockLocation = {
  id: string
  deleted_at: string | null
}

type RawProductionRun = {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
}

const LEAD_TIME_WINDOW_DAYS = 90
const LEAD_TIME_MAX_ROWS = 5000

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

  // Pull partners + websites + stock_locations + recent production_runs in
  // parallel. Each feeds a different stat below; running them concurrently
  // keeps the endpoint inside its 60s cache window comfortably.
  const leadWindowFrom = new Date(Date.now() - LEAD_TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const [partnersRes, websitesRes, locationsRes, runsRes] = await Promise.all([
    query.graph({
      entity: "partners",
      fields: ["vercel_linked", "storefront_domain"],
      filters: { status: "active" },
      pagination: { take: 1000 },
    }),
    query.graph({
      entity: "websites",
      fields: ["id", "domain", "status"],
      filters: { status: "Active" },
      pagination: { take: 200 },
    }),
    query.graph({
      entity: "stock_location",
      fields: ["id", "deleted_at"],
      pagination: { take: 500 },
    }).catch(() => ({ data: [] })),
    query.graph({
      entity: "production_runs",
      fields: ["id", "status", "started_at", "completed_at"],
      filters: { status: "completed", completed_at: { $gte: leadWindowFrom } },
      pagination: { take: LEAD_TIME_MAX_ROWS, order: { completed_at: "DESC" } },
    }).catch(() => ({ data: [] })),
  ])

  // Anyone without a provisioned storefront counts as an artisan. Aligned
  // with the partners route — workspace_type is a sidebar concept, not a
  // marketing classifier.
  let artisans = 0
  for (const p of (partnersRes.data || []) as unknown as RawPartner[]) {
    const isLiveBrand = p.vercel_linked === true && !!p.storefront_domain
    if (!isLiveBrand) artisans++
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

  // hubs = active production locations. stock_location doesn't have a
  // status field in Medusa core; soft-delete is via deleted_at, so filter
  // out tombstoned rows in memory.
  const locations = (locationsRes.data || []) as unknown as RawStockLocation[]
  const hubs = locations.filter((l) => !l.deleted_at).length

  // lead_time = avg days between started_at → completed_at for runs that
  // finished in the trailing window. Skips runs without both timestamps
  // (incomplete data) and clamps negatives just in case.
  const runs = (runsRes.data || []) as unknown as RawProductionRun[]
  let leadSumMs = 0
  let leadSamples = 0
  for (const r of runs) {
    if (!r.started_at || !r.completed_at) continue
    const ms = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
    if (ms <= 0) continue
    leadSumMs += ms
    leadSamples++
  }
  const leadAvgDays = leadSamples > 0
    ? Math.round(leadSumMs / leadSamples / (1000 * 60 * 60 * 24))
    : null

  const currency = DEFAULT_CURRENCY_BY_TLD[domain.toLowerCase()] || "USD"
  const perBrand = PROJECTION_PER_BRAND_MONTHLY[currency] ?? PROJECTION_PER_BRAND_MONTHLY.USD
  const perArtisan = PROJECTION_PER_ARTISAN_MONTHLY[currency] ?? PROJECTION_PER_ARTISAN_MONTHLY.USD
  const months = PROJECTION_WINDOW_DAYS / 30
  const projected = Math.round(brandsLive * perBrand * months + artisans * perArtisan * months)

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({
    artisans,
    brands_live: brandsLive,
    hubs,
    lead_time: {
      avg_days: leadAvgDays,
      sample_size: leadSamples,
      window_days: LEAD_TIME_WINDOW_DAYS,
    },
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
