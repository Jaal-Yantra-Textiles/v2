import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning"
import { findWebsiteByDomainWorkflow } from "../../../../../../workflows/website/find-website-by-domain"

type RawPartner = {
  workspace_type: "seller" | "manufacturer" | "individual"
  vercel_linked: boolean
}

const GMV_WINDOW_DAYS = 90
const GMV_MAX_ROWS = 50000

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { domain } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve website for GMV scope. If the domain isn't registered we still
  // return the partner counts — only GMV degrades.
  let websiteId: string | null = null
  try {
    const { result } = await findWebsiteByDomainWorkflow(req.scope).run({
      input: { domain },
    })
    websiteId = (result as any)?.id ?? null
  } catch { /* unknown domain — GMV stays null */ }

  const { data } = await query.graph({
    entity: "partners",
    fields: ["workspace_type", "vercel_linked"],
    filters: { status: "active" },
    pagination: { take: 1000 },
  })

  let artisans = 0
  let brandsLive = 0
  for (const p of (data || []) as unknown as RawPartner[]) {
    if (p.workspace_type === "individual" || p.workspace_type === "manufacturer") {
      artisans++
    } else if (p.workspace_type === "seller" && p.vercel_linked) {
      brandsLive++
    }
  }

  // Sum conversion_value for the website over the GMV window. Same data
  // source the ad-planning admin dashboard sums; here it's website-scoped
  // and trailing-90 by default so it stays "current" without a date param.
  let gmvAmount = 0
  let gmvCurrency = "USD"
  if (websiteId) {
    try {
      const adPlanning = req.scope.resolve(AD_PLANNING_MODULE) as any
      const since = new Date(Date.now() - GMV_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      const conversions = await adPlanning.listConversions(
        { website_id: websiteId, converted_at: { $gte: since } },
        { take: GMV_MAX_ROWS, order: { converted_at: "DESC" } }
      )
      for (const c of conversions || []) {
        gmvAmount += Number(c.conversion_value) || 0
        if (c.currency) gmvCurrency = String(c.currency).toUpperCase()
      }
    } catch { /* surface as 0; never block the response */ }
  }

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.status(200).json({
    artisans,
    brands_live: brandsLive,
    hubs: 3,
    gmv: {
      amount: gmvAmount,
      currency: gmvCurrency,
      window_days: GMV_WINDOW_DAYS,
    },
    last_updated: new Date().toISOString(),
  })
}
