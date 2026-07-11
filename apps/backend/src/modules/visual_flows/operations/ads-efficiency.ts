import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { SOCIALS_MODULE } from "../../socials"
import { FX_RATES_MODULE } from "../../fx_rates"

// Paid-marketing efficiency across Meta + Google, normalized to one currency.
// Reads account-level insight rows only (level = account/customer) so we don't
// double-count campaign/adset/ad breakdowns of the same spend. Spend is stored
// in each ad account's native currency; we convert to `base_currency` via the
// latest cached FX rate (a small, documented error on historical rows — same
// tradeoff the /admin/ads/insights route makes).
//
//   CAC  = spend / conversions
//   ROAS = conversions_value / spend   (Google only reports conversions_value;
//          Meta insight rows have no revenue field, so ROAS is Google-weighted)
const adsEfficiencyOptionsSchema = z.object({
  last_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .default(30)
    .describe("Rolling window (days) over the insight date."),
  base_currency: z
    .string()
    .default("INR")
    .describe("Currency to normalize spend/revenue into."),
})

function windowStartISO(lastDays: number): string {
  const to = new Date()
  to.setUTCHours(0, 0, 0, 0)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - lastDays)
  return from.toISOString().slice(0, 10)
}

export const adsEfficiencyOperation: OperationDefinition = {
  type: "ads_efficiency",
  name: "Ads Efficiency (spend / CAC / ROAS)",
  description:
    "Roll up Meta + Google ad spend, conversions and revenue over a window, FX-normalized to one currency, with CAC and ROAS.",
  icon: "currency-dollar",
  category: "data",

  optionsSchema: adsEfficiencyOptionsSchema,

  defaultOptions: {
    last_days: 30,
    base_currency: "INR",
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const parsed = adsEfficiencyOptionsSchema.parse(options ?? {})
      const base = parsed.base_currency.toUpperCase()
      const fromDate = windowStartISO(parsed.last_days)

      const socials = context.container.resolve(SOCIALS_MODULE) as any
      let fx: any = null
      try {
        fx = context.container.resolve(FX_RATES_MODULE)
      } catch {
        // FX module unavailable — conversions marked incomplete below.
      }

      let fxIncomplete = false
      const rateCache = new Map<string, number>()
      const toBase = async (amount: number, ccy?: string | null): Promise<number> => {
        const from = String(ccy || base).toUpperCase()
        if (!Number.isFinite(amount) || amount === 0) return 0
        if (from === base) return amount
        if (!fx) {
          fxIncomplete = true
          return amount
        }
        try {
          if (!rateCache.has(from)) {
            rateCache.set(from, await fx.getRate(from, base))
          }
          return amount * (rateCache.get(from) as number)
        } catch {
          fxIncomplete = true
          return amount
        }
      }

      // ── Meta (account level, native `spend` in `currency`) ──────────────
      let metaSpend = 0
      let metaConversions = 0
      try {
        const [metaRows] = await socials.listAndCountAdInsights(
          { level: "account", date_start: { $gte: fromDate } },
          { take: 20_000, order: { date_start: "DESC" } }
        )
        for (const r of metaRows as any[]) {
          metaSpend += await toBase(Number(r.spend) || 0, r.currency)
          metaConversions += Number(r.conversions) || 0
        }
      } catch {
        // Meta insights absent in this env — leave meta totals at zero.
      }

      // ── Google (customer level, `cost_micros` in `currency_code`) ───────
      let googleSpend = 0
      let googleConversions = 0
      let googleRevenue = 0
      try {
        const [gRows] = await socials.listAndCountGoogleAdsInsights(
          { level: "customer", date: { $gte: fromDate } },
          { take: 20_000, order: { date: "DESC" } }
        )
        for (const r of gRows as any[]) {
          const spend = (Number(r.cost_micros) || 0) / 1_000_000
          googleSpend += await toBase(spend, r.currency_code)
          googleConversions += Number(r.conversions) || 0
          googleRevenue += await toBase(
            Number(r.conversions_value) || 0,
            r.currency_code
          )
        }
      } catch {
        // Google insights absent in this env — leave google totals at zero.
      }

      const spend = metaSpend + googleSpend
      const conversions = metaConversions + googleConversions
      const conversionsValue = googleRevenue // only Google reports revenue
      const cac = conversions > 0 ? spend / conversions : null
      const roas = spend > 0 ? conversionsValue / spend : null

      return {
        success: true,
        data: {
          currency: base,
          window_days: parsed.last_days,
          spend: Math.round(spend),
          conversions: Math.round(conversions),
          conversions_value: Math.round(conversionsValue),
          cac: cac == null ? null : Math.round(cac),
          roas: roas == null ? null : Math.round(roas * 100) / 100,
          by_platform: {
            meta: { spend: Math.round(metaSpend), conversions: Math.round(metaConversions) },
            google: {
              spend: Math.round(googleSpend),
              conversions: Math.round(googleConversions),
              conversions_value: Math.round(googleRevenue),
            },
          },
          fx_incomplete: fxIncomplete,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
