import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { getValueByPath } from "./utils"

// metric_sections — the DYNAMIC stats operation. Instead of a bespoke
// operation per business metric, a panel declares NAMED SECTIONS and each
// section is a declarative spec over live entities:
//
//   operation_type: "metric_sections"
//   operation_options: {
//     currency: "INR",
//     window_days: 30,
//     sections: {
//       orders: {
//         entity: "order_transaction",
//         filters: { reference: "capture" },
//         aggregates: {
//           processed:    { fn: "count_distinct", field: "order_id" },
//           trailing_30d: { fn: "count_distinct", field: "order_id",
//                           range: { date_field: "created_at", last_days: 30 } },
//         },
//         echo: { window_days: true },
//       },
//       commission: { entity: "partner_fee", currency_key: "currency_code",
//         filters: { status: "accrued" },
//         aggregates: {
//           accrued:      { fn: "sum", field: "fee_amount" },
//           trailing_30d: { fn: "sum", field: "fee_amount",
//                           range: { date_field: "accrued_at", last_days: 30 } },
//         },
//         echo: { currency: true, window_days: true } },
//       aov: { entity: "order_transaction", filters: { reference: "capture" },
//              currency_key: "currency_code",
//              aggregates: { amount: { fn: "avg", field: "amount",
//                                      range: { last_days: 30 } } },
//              echo: { currency: true } },
//       subscription: { entity: "partner_subscription", currency_key: "plan.currency_code",
//         filters: { status: "active" },
//         aggregates: {
//           paying_artisans: { fn: "count_distinct", field: "partner_id" },
//           mrr: { fn: "sum", field: "plan.price",
//                  normalize_interval: { interval_field: "plan.interval", yearly_divisor: 12 } },
//         },
//         echo: { currency: true } },
//       arr: { derived: { ref: "subscription", aggregate: "mrr", multiply: 12 },
//              echo: { currency: true } },
//     },
//   }
//
// → data: { orders: { processed, trailing_30d, window_days },
//           commission: { accrued, trailing_30d, currency, window_days },
//           aov: { amount, currency },
//           subscription: { paying_artisans, mrr, currency },
//           arr: { amount, currency },
//           currency, window_days }
//
// Vocabulary (all generic — nothing business-specific in code):
//   entity section    — one query.graph fetch; every named aggregate computed
//                       in-process over the fetched rows
//   aggregates        — count | sum | avg | min | max | count_distinct over a
//                       (possibly nested) field path
//   range             — bounds an aggregate's rows to a date window
//                       ({ last_days } or { from, to })
//   normalize_interval— monthly-normalize a price by the row's interval
//                       (yearly price / 12) before aggregating
//   currency_key      — row-level currency filter (sections only count rows
//                       priced in the top-level currency) + currency echo
//   echo              — which context keys the section payload carries
//   derived section   — an arithmetic expression over another section's
//                       aggregate (e.g. ARR = MRR × 12)
//
// Sections resolve independently: one broken/renamed entity degrades its own
// section to { error } with a warning instead of failing the whole panel —
// same partial-snapshot honesty as GET /admin/mcp/stats.

const rangeSchema = z.union([
  z.object({
    date_field: z.string().optional().default("created_at"),
    last_days: z.number().int().positive().max(3650),
  }),
  z.object({
    date_field: z.string().optional().default("created_at"),
    from: z.string().describe("ISO date (inclusive)"),
    to: z.string().describe("ISO date (exclusive)"),
  }),
])

const aggregateSpecSchema = z.object({
  fn: z.enum(["count", "sum", "avg", "min", "max", "count_distinct"]).default("count"),
  field: z
    .string()
    .optional()
    .describe("Field to aggregate (possibly nested). Required for all fns except 'count'."),
  range: rangeSchema
    .optional()
    .describe("Optional date window bounding this aggregate's rows."),
  normalize_interval: z
    .object({
      interval_field: z.string().describe("Row path carrying the interval (monthly | yearly)."),
      yearly_divisor: z.number().positive().default(12),
    })
    .optional()
    .describe("Monthly-normalize the field before aggregating (yearly price / 12)."),
})

const entitySectionSpecSchema = z.object({
  entity: z.string().min(1).describe("Entity name to query via query.graph."),
  filters: z.record(z.string(), z.any()).optional().describe("Filter conditions."),
  aggregates: z
    .record(z.string(), aggregateSpecSchema)
    .describe("Named aggregates — one result key per name."),
  currency_key: z
    .string()
    .optional()
    .describe(
      "Row path carrying the currency. Rows priced in any other currency (or unpriced) are excluded from every aggregate in this section."
    ),
  echo: z
    .object({
      currency: z.boolean().optional(),
      window_days: z.boolean().optional(),
    })
    .optional()
    .describe(
      "Which context keys to carry into this section's payload — an OBJECT of booleans, e.g. { window_days: true } or { currency: true, window_days: true }. NOT text: the section's label is the section name itself. Omit for no echoed keys."
    ),
  fetch_limit: z
    .number()
    .int()
    .positive()
    .max(100_000)
    .optional()
    .default(50_000)
    .describe("Max rows fetched before in-process aggregation."),
})

const derivedSectionSpecSchema = z.object({
  derived: z.object({
    ref: z.string().describe("Another section's name."),
    aggregate: z.string().describe("That section's aggregate key."),
    multiply: z.number().optional().default(1),
    add: z.number().optional().default(0),
  }),
  echo: z
    .object({ currency: z.boolean().optional(), window_days: z.boolean().optional() })
    .optional()
    .describe("Which context keys to echo — an OBJECT of booleans, e.g. { currency: true }. NOT text."),
})

const sectionSpecSchema = z.union([entitySectionSpecSchema, derivedSectionSpecSchema])

const metricSectionsOptionsSchema = z.object({
  currency: z
    .string()
    .default("INR")
    .describe("Top-level currency: filters every section that declares currency_key and is echoed."),
  window_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .default(30)
    .describe("Default window echoed and used by aggregates whose range omits last_days/from-to."),
  sections: z
    .record(z.string(), sectionSpecSchema)
    .describe("Named sections — one payload key per name."),
})

const round2 = (n: number) => Math.round(n * 100) / 100

/** bigNumber columns surface through query.graph as strings — coerce like aggregateValues does. */
const toFiniteNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Inclusive-from / exclusive-to window, aligned to UTC day boundaries (mirrors aggregate-data). */
function resolveWindow(
  range: { from?: string; to?: string; last_days?: number },
  now: Date
): { from: string; to: string } {
  if ("last_days" in range && range.last_days != null) {
    const to = new Date(now)
    to.setUTCHours(0, 0, 0, 0)
    to.setUTCDate(to.getUTCDate() + 1)
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - range.last_days)
    return { from: from.toISOString(), to: to.toISOString() }
  }
  return {
    from: new Date(range.from!).toISOString(),
    to: new Date(range.to!).toISOString(),
  }
}

/** Fetch-then-aggregate one entity section. Returns the section payload. */
async function resolveEntitySection(
  name: string,
  section: z.infer<typeof entitySectionSpecSchema>,
  ctx: { query: any; currency: string; windowDays: number; now: Date; warnings: string[] }
): Promise<Record<string, any>> {
  const currencyLower = ctx.currency.toLowerCase()

  const aggregates = section.aggregates ?? {}
  const aggNames = Object.keys(aggregates)

  // ── One graph fetch: union of every field the aggregates touch ──────
  const requested = new Set<string>()
  let needsRows = false
  for (const [aggName, agg] of Object.entries(aggregates)) {
    if (agg.fn === "count") {
      needsRows = true
      continue
    }
    if (!agg.field) {
      throw new Error(`section '${name}' aggregate '${aggName}': field is required when fn is '${agg.fn}'`)
    }
    requested.add(agg.field)
    if (agg.normalize_interval) requested.add(agg.normalize_interval.interval_field)
  }
  if (section.currency_key) requested.add(section.currency_key)
  for (const agg of Object.values(aggregates)) {
    if (agg.range) requested.add(agg.range.date_field || "created_at")
  }
  if (requested.size === 0 && needsRows) requested.add("id")

  const graphFilters = { ...(section.filters ?? {}) }
  const graphOptions: Record<string, any> = {
    entity: section.entity,
    fields: Array.from(requested),
  }
  if (Object.keys(graphFilters).length > 0) graphOptions.filters = graphFilters
  graphOptions.pagination = { take: section.fetch_limit, skip: 0 }

  const result = await ctx.query.graph(graphOptions)
  const rows: any[] = result?.data || []
  const truncated = rows.length === section.fetch_limit
  if (truncated) {
    ctx.warnings.push(
      `section '${name}' truncated at fetch_limit ${section.fetch_limit} — aggregates are computed over the fetched rows`
    )
  }

  // ── Row-level currency gate (the generic section filter) ────────────
  const eligibleRows = rows.filter((row) => {
    if (!section.currency_key) return true
    const rowCurrency = String(getValueByPath(row, section.currency_key) ?? "").toLowerCase()
    return rowCurrency !== "" && rowCurrency === currencyLower
  })

  // ── Compute every named aggregate ───────────────────────────────────
  const payload: Record<string, any> = {}
  for (const [aggName, agg] of Object.entries(aggregates)) {
    let subset = eligibleRows
    if (agg.range) {
      const window = resolveWindow(agg.range as any, ctx.now)
      const dateField = agg.range.date_field || "created_at"
      subset = subset.filter((row) => {
        const v = getValueByPath(row, dateField)
        if (v === null || v === undefined) return false
        const t = new Date(v as any).getTime()
        return Number.isFinite(t) && t >= new Date(window.from).getTime() && t < new Date(window.to).getTime()
      })
    }

    let value: number | null
    if (agg.fn === "count") {
      value = subset.length
    } else if (agg.fn === "count_distinct") {
      const set = new Set<string>()
      for (const row of subset) {
        const v = getValueByPath(row, agg.field!)
        if (v === null || v === undefined) continue
        set.add(String(v))
      }
      value = set.size
    } else {
      const numeric: number[] = []
      for (const row of subset) {
        let v = toFiniteNumber(getValueByPath(row, agg.field!))
        if (v === null) continue
        if (agg.normalize_interval) {
          const interval = String(
            getValueByPath(row, agg.normalize_interval.interval_field) ?? "monthly"
          ).toLowerCase()
          if (interval === "yearly") v = v / (agg.normalize_interval.yearly_divisor ?? 12)
        }
        numeric.push(v)
      }
      value =
        numeric.length === 0
          ? agg.fn === "sum"
            ? 0
            : null
          : agg.fn === "sum"
            ? numeric.reduce((a, b) => a + b, 0)
            : agg.fn === "avg"
              ? numeric.reduce((a, b) => a + b, 0) / numeric.length
              : agg.fn === "min"
                ? Math.min(...numeric)
                : agg.fn === "max"
                  ? Math.max(...numeric)
                  : null
      if (value !== null) value = round2(value)
    }

    payload[aggName] = value
  }

  // ── Echoes ───────────────────────────────────────────────────────────
  if (section.echo?.currency || section.currency_key) payload.currency = ctx.currency
  if (section.echo?.window_days) payload.window_days = ctx.windowDays

  return payload
}

export const metricSectionsOperation: OperationDefinition = {
  type: "metric_sections",
  name: "Metric Sections",
  description:
    "Dynamic stats panel: NAMED metric sections derived declaratively from live entities (counts, sums, trailing windows, monthly-normalized MRR, derived ratios) — the section keys are panel config, not code.",
  icon: "chart-no-axes-combined",
  category: "data",

  optionsSchema: metricSectionsOptionsSchema,

  defaultOptions: {
    currency: "INR",
    window_days: 30,
    sections: {},
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    const warnings: string[] = []

    try {
      const parsed = metricSectionsOptionsSchema.parse(options ?? {})
      const currency = parsed.currency.toUpperCase()
      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
      const now = new Date()

      const data: Record<string, any> = {}
      const ctx = { query, currency, windowDays: parsed.window_days, now, warnings }

      // ── Entity sections (independent, Promise.all for latency) ──────
      const entitySectionNames = Object.keys(parsed.sections).filter(
        (name) => (parsed.sections as Record<string, any>)[name].entity !== undefined
      )
      const derivedSectionNames = Object.keys(parsed.sections).filter(
        (name) => (parsed.sections as Record<string, any>)[name].derived !== undefined
      )

      await Promise.all(
        entitySectionNames.map(async (name) => {
          const section = (parsed.sections as Record<string, any>)[name]
          try {
            data[name] = await resolveEntitySection(name, section, ctx)
          } catch (error: any) {
            data[name] = { error: error?.message }
            warnings.push(`section '${name}' degraded: ${error?.message}`)
          }
        })
      )

      // ── Derived sections (arithmetic over other sections' aggregates) ─
      for (const name of derivedSectionNames) {
        const section = (parsed.sections as Record<string, any>)[name]
        const refSection = data[section.derived.ref]
        const refValue = refSection ? refSection[section.derived.aggregate] : undefined

        if (typeof refValue !== "number" || !Number.isFinite(refValue)) {
          data[name] = { error: `derived ref '${section.derived.ref}.${section.derived.aggregate}' is not a number` }
          warnings.push(`section '${name}' degraded: derived ref not a number`)
          continue
        }

        const value = round2(refValue * section.derived.multiply + section.derived.add)
        const payload: Record<string, any> = { amount: value }
        if (section.echo?.currency) payload.currency = currency
        if (section.echo?.window_days) payload.window_days = parsed.window_days
        data[name] = payload
      }

      // ── Top-level context echoes ─────────────────────────────────────
      data.currency = currency
      data.window_days = parsed.window_days
      if (warnings.length > 0) data.warnings = warnings

      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error?.message, errorStack: error?.stack }
    }
  },
}
