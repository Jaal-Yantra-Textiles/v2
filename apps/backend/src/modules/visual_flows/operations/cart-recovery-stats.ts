import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { AD_PLANNING_MODULE } from "../../ad-planning"
import { ANALYTICS_MODULE } from "../../analytics"

/**
 * Cart-recovery dashboard operation.
 *
 * Aggregates carts in a recent window and joins them to per-visitor
 * browsing signals so the stats module can render coverage and intent
 * panels without us building a bespoke admin page.
 *
 * Why this isn't doable with `aggregate_data` alone:
 *   - filters go through `query.graph` which can't reach JSONB paths
 *     (e.g. `cart.metadata.visitor_id`)
 *   - intent score is per-cart and crosses two modules; no single op
 *     can express that with template variables
 *   - none of the existing ops support a relative-date filter for
 *     non-time-series shapes
 *
 * Three output modes feed three panel kinds:
 *   - "summary" → flat scalar object; metric panels read it via
 *     `display.field` (`total`, `with_visitor_id`, `stamping_rate_pct`,
 *     `high_intent_pct`, etc.)
 *   - "intent_distribution" → `{ groups: [{key, value}] }` for a bar
 *     panel
 *   - "stamping_trend" → `{ buckets: [{date, value, total, stamped}] }`
 *     for a line/area panel
 */

const cartRecoveryOptionsSchema = z.object({
  last_days: z.number().int().min(1).max(180).default(30),
  output: z
    .enum(["summary", "intent_distribution", "stamping_trend"])
    .default("summary"),
  // Cap on carts scanned. 99 carts in prod today; 5000 buys headroom
  // without turning a panel into a slow query.
  fetchLimit: z.number().int().positive().max(20_000).default(5_000),
})

type IntentLevel = "high" | "medium" | "low"

function bucketLevel(score: number): IntentLevel {
  return score >= 70 ? "high" : score >= 30 ? "medium" : "low"
}

function dayKey(d: Date): string {
  // Use UTC YYYY-MM-DD so trend buckets line up across timezones.
  return d.toISOString().slice(0, 10)
}

export const cartRecoveryStatsOperation: OperationDefinition = {
  type: "cart_recovery_stats",
  name: "Cart Recovery Stats",
  description:
    "Aggregates abandoned carts + visitor browsing signals into summary metrics, intent distribution, or a stamping-coverage trend. Pairs with the visitor_id stamp on cart.metadata and the same intent score served by GET /web/ad-planning/intent.",
  icon: "shopping-cart",
  category: "data",
  optionsSchema: cartRecoveryOptionsSchema,

  defaultOptions: {
    last_days: 30,
    output: "summary",
    fetchLimit: 5_000,
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const parsed = cartRecoveryOptionsSchema.parse(options ?? {})
      const since = new Date(Date.now() - parsed.last_days * 24 * 3600 * 1000)

      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
      const adPlanning: any = context.container.resolve(AD_PLANNING_MODULE)
      const analytics: any = context.container.resolve(ANALYTICS_MODULE)

      // 1. Pull non-completed carts created in window. Filtering on
      //    completed_at: null targets the recovery audience — completed
      //    orders aren't relevant to "stamping coverage" since the
      //    funnel finished.
      const cartsResult = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "email",
          "shipping_address_id",
          "created_at",
          "metadata",
        ],
        filters: {
          created_at: { $gte: since },
          completed_at: null,
        },
        pagination: { take: parsed.fetchLimit, skip: 0 },
      } as any)
      const carts: Array<{
        id: string
        email: string | null
        shipping_address_id: string | null
        created_at: string
        metadata: Record<string, any> | null
      }> = (cartsResult?.data as any[]) ?? []

      const total = carts.length

      // 2. Top-line counts that need no analytics join.
      let withVisitorId = 0
      let withEmail = 0
      let atCheckout = 0
      const visitorIds: string[] = []
      const cartByVisitor = new Map<string, typeof carts[number]>()
      for (const c of carts) {
        if (c.email) withEmail++
        if (c.shipping_address_id) atCheckout++
        const v = (c.metadata as any)?.visitor_id as string | undefined
        if (typeof v === "string" && v.length > 0) {
          withVisitorId++
          visitorIds.push(v)
          cartByVisitor.set(v, c)
        }
      }

      // 3. Per-visitor signals — one batch query each into analytics
      //    and conversion, then group in-process. Avoids N round trips
      //    when there are hundreds of stamped carts.
      const intentByCart = new Map<string, IntentLevel>()
      let highIntent = 0
      let mediumIntent = 0
      let lowIntent = 0

      if (visitorIds.length > 0) {
        const events: any[] = await analytics.listAnalyticsEvents(
          { visitor_id: visitorIds, timestamp: { $gte: since } },
          { take: 50_000, order: { timestamp: "DESC" } },
        )
        const conversions: any[] = await adPlanning.listConversions(
          { visitor_id: visitorIds, converted_at: { $gte: since } },
          { take: 50_000, order: { converted_at: "DESC" } },
        )

        // Per-visitor accumulators.
        const sigByVisitor = new Map<
          string,
          {
            pageviews: number
            hasEngagement: boolean
            // Per-page best-of so cumulative threshold rows don't sum.
            scrollByPage: Map<string, number>
            timeByPage: Map<string, number>
          }
        >()
        const ensure = (vid: string) => {
          let s = sigByVisitor.get(vid)
          if (!s) {
            s = {
              pageviews: 0,
              hasEngagement: false,
              scrollByPage: new Map(),
              timeByPage: new Map(),
            }
            sigByVisitor.set(vid, s)
          }
          return s
        }

        for (const e of events) {
          const s = ensure(e.visitor_id as string)
          if (e.event_type === "pageview") s.pageviews++
          if (e.event_name === "page_engagement") s.hasEngagement = true
        }

        for (const c of conversions) {
          const s = ensure(c.visitor_id as string)
          const md = (c.metadata ?? {}) as Record<string, any>
          const page = (md.page as string | undefined) ?? "_unknown"
          if (c.conversion_type === "scroll_depth") {
            const d = Number(md.depth ?? 0)
            if (Number.isFinite(d) && d > (s.scrollByPage.get(page) ?? 0)) {
              s.scrollByPage.set(page, d)
            }
          } else if (c.conversion_type === "time_on_site") {
            const t = Number(md.seconds ?? 0)
            if (Number.isFinite(t) && t > (s.timeByPage.get(page) ?? 0)) {
              s.timeByPage.set(page, t)
            }
          } else if (c.conversion_type === "page_engagement") {
            s.hasEngagement = true
          }
        }

        for (const [vid, cart] of cartByVisitor) {
          const s = sigByVisitor.get(vid)
          let pageviews = 0
          let maxScrollDepth = 0
          let totalTimeOnSite = 0
          let hasEngagement = false
          if (s) {
            pageviews = s.pageviews
            hasEngagement = s.hasEngagement
            for (const v of s.scrollByPage.values()) {
              if (v > maxScrollDepth) maxScrollDepth = v
            }
            for (const v of s.timeByPage.values()) {
              totalTimeOnSite += v
            }
          }
          const { score } = adPlanning.computeIntentScore({
            pageviews,
            maxScrollDepth,
            totalTimeOnSite,
            hasEngagement,
          })
          const level = bucketLevel(score)
          intentByCart.set(cart.id, level)
          if (level === "high") highIntent++
          else if (level === "medium") mediumIntent++
          else lowIntent++
        }
      }

      const stampingRatePct = total === 0 ? 0 : Math.round((withVisitorId / total) * 100)
      const highIntentPct =
        withVisitorId === 0 ? 0 : Math.round((highIntent / withVisitorId) * 100)

      if (parsed.output === "summary") {
        return {
          success: true,
          data: {
            // `value` is the metric-panel default. We point it at total
            // so a panel left at defaults still renders something useful.
            value: total,
            total,
            with_visitor_id: withVisitorId,
            with_email: withEmail,
            at_checkout: atCheckout,
            stamping_rate_pct: stampingRatePct,
            high_intent: highIntent,
            medium_intent: mediumIntent,
            low_intent: lowIntent,
            high_intent_pct: highIntentPct,
            row_count: total,
            window_days: parsed.last_days,
          },
        }
      }

      if (parsed.output === "intent_distribution") {
        return {
          success: true,
          data: {
            groups: [
              { key: "high", keys: { level: "high" }, value: highIntent },
              { key: "medium", keys: { level: "medium" }, value: mediumIntent },
              { key: "low", keys: { level: "low" }, value: lowIntent },
            ],
            row_count: withVisitorId,
            group_count: 3,
            truncated: false,
          },
        }
      }

      // stamping_trend — bucket by day using `value` = stamping_rate_pct.
      // Total + stamped carried alongside so a renderer or a future
      // panel can show absolute counts too.
      const perDay = new Map<string, { total: number; stamped: number }>()
      // Pre-seed every day in the window so the chart isn't gappy.
      for (let i = parsed.last_days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 3600 * 1000)
        perDay.set(dayKey(d), { total: 0, stamped: 0 })
      }
      for (const c of carts) {
        const k = dayKey(new Date(c.created_at))
        const entry = perDay.get(k) ?? { total: 0, stamped: 0 }
        entry.total++
        if ((c.metadata as any)?.visitor_id) entry.stamped++
        perDay.set(k, entry)
      }
      const buckets = [...perDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, { total, stamped }]) => ({
          date,
          value: total === 0 ? 0 : Math.round((stamped / total) * 100),
          total,
          stamped,
        }))

      return {
        success: true,
        data: {
          buckets,
          row_count: total,
          truncated: false,
          precision: "day",
          from: since.toISOString(),
          to: new Date().toISOString(),
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
