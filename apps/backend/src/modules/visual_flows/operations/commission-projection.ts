import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"

// Forward per-order commission run-rate. The platform earns a commission on
// every partner sale, so the projection is derived — not assumed — from the
// live catalogue:
//   commission_per_order = avg_partner_product_price × commission_rate
//   projected            = commission_per_order × orders_per_month × months
// `orders_per_month` defaults to the actual last-30-day order count (the real
// run-rate) unless the caller pins it. Keeps the investor number honest: it
// moves with the catalogue's prices and the store's real order velocity.
const DEFAULT_COMMISSION_BPS = 200 // 2% — PLATFORM_DEFAULT_FEE_BPS

const commissionProjectionOptionsSchema = z.object({
  currency: z
    .string()
    .default("INR")
    .describe("Currency the average price + projection are expressed in."),
  commission_bps: z
    .number()
    .int()
    .positive()
    .max(10000)
    .default(DEFAULT_COMMISSION_BPS)
    .describe("Platform commission in basis points (200 = 2%)."),
  orders_per_month: z
    .number()
    .nonnegative()
    .optional()
    .describe("Override projected orders/month. Omit to use the real last-30d run-rate."),
  window_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .default(90)
    .describe("Projection horizon in days. Monthly run-rate × (window_days / 30)."),
})

export const commissionProjectionOperation: OperationDefinition = {
  type: "commission_projection",
  name: "Commission Projection",
  description:
    "Forward per-order commission run-rate, derived from average partner product price × platform commission × order velocity.",
  icon: "receipt-percent",
  category: "data",

  optionsSchema: commissionProjectionOptionsSchema,

  defaultOptions: {
    currency: "INR",
    commission_bps: DEFAULT_COMMISSION_BPS,
    window_days: 90,
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const parsed = commissionProjectionOptionsSchema.parse(options ?? {})
      const currency = parsed.currency.toUpperCase()
      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)

      // --- Average partner product price (from the live catalogue's variant prices) ---
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "variants.prices.amount", "variants.prices.currency_code"],
        filters: { status: "published" },
        pagination: { take: 5000 },
      }).catch(() => ({ data: [] as any[] }))

      const prices: number[] = []
      for (const p of (products || []) as any[]) {
        for (const v of p.variants || []) {
          for (const pr of v.prices || []) {
            if (
              String(pr.currency_code || "").toUpperCase() === currency &&
              typeof pr.amount === "number" &&
              pr.amount > 0
            ) {
              prices.push(pr.amount)
            }
          }
        }
      }
      const avgPrice = prices.length
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : 0

      // --- Orders per month: real last-30d run-rate unless pinned ---
      let ordersPerMonth = parsed.orders_per_month
      if (ordersPerMonth == null) {
        const since = new Date()
        since.setDate(since.getDate() - 30)
        const res = await query.graph({
          entity: "order",
          fields: ["id"],
          filters: { created_at: { $gte: since } as any },
          pagination: { take: 1 },
        }).catch(() => ({ data: [] as any[], metadata: { count: 0 } }))
        ordersPerMonth = (res as any)?.metadata?.count ?? res.data?.length ?? 0
      }

      const ordersRunRate = ordersPerMonth ?? 0
      const commissionRate = parsed.commission_bps / 10000
      const commissionPerOrder = avgPrice * commissionRate
      const months = parsed.window_days / 30
      const amount = Math.round(commissionPerOrder * ordersRunRate * months)

      return {
        success: true,
        data: {
          amount,
          currency,
          window_days: parsed.window_days,
          source: "projected",
          avg_product_price: Math.round(avgPrice),
          commission_bps: parsed.commission_bps,
          orders_per_month: ordersRunRate,
          formula: {
            commission_per_order: Math.round(commissionPerOrder),
            commission_rate: commissionRate,
            months,
          },
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
