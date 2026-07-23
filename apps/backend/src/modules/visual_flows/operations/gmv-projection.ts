import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"

// Forward GMV run-rate projection. Mirrors the marketing-site metrics endpoint
// (src/api/web/website/[domain]/marketing/metrics/route.ts) so the investor
// Projections tab and the public marketing strip tell the same story:
//   projected = brands_live × per_brand_monthly × months
//             + artisans   × per_artisan_monthly × months
// Conservative, defensible run-rate framing — not an aspirational ceiling.
const PROJECTION_PER_BRAND_MONTHLY: Record<string, number> = {
  INR: 2_000,
  USD: 24,
  EUR: 22,
}
const PROJECTION_PER_ARTISAN_MONTHLY: Record<string, number> = {
  INR: 100,
  USD: 1,
  EUR: 1,
}

// Platform's own marketing hosts — excluded from brands_live so the number
// reflects ateliers, not us. Same set the marketing-metrics route excludes.
const PLATFORM_HOSTS = new Set<string>([
  "jaalyantra.com",
  "www.jaalyantra.com",
  "kindhealth.com",
  "www.kindhealth.com",
])

const gmvProjectionOptionsSchema = z.object({
  currency: z
    .string()
    .default("INR")
    .describe("Currency the projection is expressed in (INR | USD | EUR)."),
  window_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .default(90)
    .describe("Projection horizon in days. Monthly run-rate × (window_days / 30)."),
})

export const gmvProjectionOperation: OperationDefinition = {
  type: "gmv_projection",
  name: "GMV Projection",
  description:
    "Forward GMV run-rate from live brands + artisans over a horizon. Mirrors the marketing-site projection formula.",
  icon: "arrow-trending-up",
  category: "data",

  optionsSchema: gmvProjectionOptionsSchema,

  defaultOptions: {
    currency: "INR",
    window_days: 90,
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const parsed = gmvProjectionOptionsSchema.parse(options ?? {})
      const currency = parsed.currency.toUpperCase()
      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)

      const [partnersRes, websitesRes] = await Promise.all([
        query.graph({
          entity: "partners",
          fields: ["vercel_linked", "storefront_domain"],
          filters: { status: "active" },
          pagination: { take: 1000 },
        }).catch(() => ({ data: [] })),
        query.graph({
          entity: "websites",
          fields: ["id", "domain", "status"],
          filters: { status: "Active" },
          pagination: { take: 200 },
        }).catch(() => ({ data: [] })),
      ])

      // Anyone without a provisioned storefront counts as an artisan — aligned
      // with the partners route: workspace_type is a sidebar concept, not a
      // marketing classifier.
      let artisans = 0
      for (const p of (partnersRes.data || []) as any[]) {
        const isLiveBrand = p.vercel_linked === true && !!p.storefront_domain
        if (!isLiveBrand) artisans++
      }

      const sites = (websitesRes.data || []) as Array<{ domain: string }>
      const brandsLive = sites.filter(
        (w) => !PLATFORM_HOSTS.has(String(w.domain || "").toLowerCase())
      ).length

      const perBrand =
        PROJECTION_PER_BRAND_MONTHLY[currency] ?? PROJECTION_PER_BRAND_MONTHLY.USD
      const perArtisan =
        PROJECTION_PER_ARTISAN_MONTHLY[currency] ?? PROJECTION_PER_ARTISAN_MONTHLY.USD
      const months = parsed.window_days / 30
      const amount = Math.round(
        brandsLive * perBrand * months + artisans * perArtisan * months
      )

      return {
        success: true,
        data: {
          amount,
          currency,
          window_days: parsed.window_days,
          source: "projected",
          brands_live: brandsLive,
          artisans,
          formula: {
            per_brand_monthly: perBrand,
            per_artisan_monthly: perArtisan,
            months,
          },
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
