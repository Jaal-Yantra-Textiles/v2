import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

type Precision = "day" | "week" | "month"

const rangeSchema = z.union([
  z.object({
    from: z.string().describe("ISO date (inclusive)"),
    to: z.string().describe("ISO date (exclusive)"),
  }),
  z.object({
    last_days: z.number().int().positive().max(3650),
  }),
])

const timeSeriesOptionsSchema = z.object({
  entity: z.string().describe("Entity name to query via query.graph"),
  dateField: z.string().describe("Field on the entity to bucket by"),
  fields: z.array(z.string()).optional(),
  filters: z.record(z.string(), z.any()).optional(),
  aggregate: z
    .object({
      fn: z.enum(["count", "sum", "avg", "min", "max"]).default("count"),
      field: z.string().optional(),
    })
    .default({ fn: "count" }),
  precision: z.enum(["day", "week", "month"]).default("day"),
  range: rangeSchema,
  groupBy: z
    .string()
    .optional()
    .describe("Optional series split — produces one series per distinct value"),
  fetchLimit: z.number().int().positive().max(200_000).default(50_000),
  fillGaps: z
    .boolean()
    .default(true)
    .describe("Emit zero buckets for periods with no data"),
})

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

function startOfWeek(d: Date): Date {
  // ISO week: Monday-start
  const x = startOfDay(d)
  const day = x.getUTCDay()
  const diff = (day + 6) % 7
  x.setUTCDate(x.getUTCDate() - diff)
  return x
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function bucketStart(d: Date, precision: Precision): Date {
  if (precision === "day") return startOfDay(d)
  if (precision === "week") return startOfWeek(d)
  return startOfMonth(d)
}

function addPrecision(d: Date, precision: Precision, n = 1): Date {
  const x = new Date(d)
  if (precision === "day") x.setUTCDate(x.getUTCDate() + n)
  else if (precision === "week") x.setUTCDate(x.getUTCDate() + 7 * n)
  else x.setUTCMonth(x.getUTCMonth() + n)
  return x
}

function toKey(d: Date, precision: Precision): string {
  if (precision === "month") {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, "0")
    return `${y}-${m}`
  }
  return d.toISOString().slice(0, 10)
}

function aggregateNumeric(
  fn: "count" | "sum" | "avg" | "min" | "max",
  values: Array<unknown>
): number {
  if (fn === "count") return values.length
  const nums: number[] = []
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue
    const n = typeof v === "number" ? v : Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length === 0) return fn === "sum" ? 0 : 0
  if (fn === "sum") return nums.reduce((a, b) => a + b, 0)
  if (fn === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length
  if (fn === "min") return Math.min(...nums)
  return Math.max(...nums)
}

function resolveNested(obj: any, path: string): unknown {
  if (obj == null) return undefined
  const parts = path.split(".")
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

export const timeSeriesOperation: OperationDefinition = {
  type: "time_series",
  name: "Time Series",
  description:
    "Bucket entity rows by day/week/month over a date range. Supports count/sum/avg/min/max and an optional series split.",
  icon: "chart-bar",
  category: "data",

  optionsSchema: timeSeriesOptionsSchema,

  defaultOptions: {
    entity: "",
    dateField: "created_at",
    aggregate: { fn: "count" },
    precision: "day",
    range: { last_days: 30 },
    fetchLimit: 50_000,
    fillGaps: true,
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const entity = interpolateString(options.entity, context.dataChain)
      const dateField = interpolateString(options.dateField, context.dataChain)

      if (!entity) return { success: false, error: "entity is required" }
      if (!dateField) return { success: false, error: "dateField is required" }

      const parsed = timeSeriesOptionsSchema.parse({
        ...options,
        entity,
        dateField,
      })

      const now = new Date()
      let from: Date
      let to: Date
      if ("last_days" in parsed.range) {
        to = addPrecision(bucketStart(now, parsed.precision), parsed.precision, 1)
        const start = new Date(to)
        start.setUTCDate(start.getUTCDate() - parsed.range.last_days)
        from = bucketStart(start, parsed.precision)
      } else {
        from = bucketStart(new Date(parsed.range.from), parsed.precision)
        to = bucketStart(new Date(parsed.range.to), parsed.precision)
      }

      const fn = parsed.aggregate.fn
      const aggField = parsed.aggregate.field
      if (fn !== "count" && !aggField) {
        return {
          success: false,
          error: `aggregate.field is required when fn is '${fn}'`,
        }
      }

      const rawFilters = parsed.filters
        ? interpolateVariables(parsed.filters, context.dataChain)
        : {}
      const filters: Record<string, any> = { ...(rawFilters as Record<string, any>) }

      // Scope to date range
      filters[dateField] = {
        $gte: from.toISOString(),
        $lt: to.toISOString(),
      }

      const fieldSet = new Set<string>()
      if (parsed.fields?.length) parsed.fields.forEach((f) => fieldSet.add(f))
      fieldSet.add(dateField)
      if (aggField) fieldSet.add(aggField)
      if (parsed.groupBy) fieldSet.add(parsed.groupBy)
      if (fieldSet.size === 0) fieldSet.add("id")

      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
      const result = await query.graph({
        entity,
        fields: Array.from(fieldSet),
        filters,
        pagination: { take: parsed.fetchLimit, skip: 0 },
      })
      const rows: any[] = result?.data || []

      // Bucket rows
      const bucketMap = new Map<string, Map<string, any[]>>() // dateKey -> series -> rows
      for (const row of rows) {
        const rawDate = resolveNested(row, dateField)
        if (!rawDate) continue
        const d = new Date(rawDate as string)
        if (Number.isNaN(d.getTime())) continue
        const bucket = bucketStart(d, parsed.precision)
        const key = toKey(bucket, parsed.precision)

        const series = parsed.groupBy
          ? String(resolveNested(row, parsed.groupBy) ?? "__null__")
          : "__all__"

        if (!bucketMap.has(key)) bucketMap.set(key, new Map())
        const seriesMap = bucketMap.get(key)!
        if (!seriesMap.has(series)) seriesMap.set(series, [])
        seriesMap.get(series)!.push(row)
      }

      // Optionally fill gaps
      const allKeys: string[] = []
      if (parsed.fillGaps) {
        let cur = bucketStart(from, parsed.precision)
        while (cur < to) {
          allKeys.push(toKey(cur, parsed.precision))
          cur = addPrecision(cur, parsed.precision, 1)
        }
      } else {
        allKeys.push(...Array.from(bucketMap.keys()).sort())
      }

      const seriesNames = new Set<string>()
      for (const m of bucketMap.values()) {
        for (const s of m.keys()) seriesNames.add(s)
      }
      if (seriesNames.size === 0) seriesNames.add(parsed.groupBy ? "__empty__" : "__all__")

      const buckets: Array<{ date: string; value: number; series?: string }> = []
      for (const key of allKeys) {
        const seriesMap = bucketMap.get(key)
        for (const series of seriesNames) {
          const bucketRows = seriesMap?.get(series) || []
          const values = aggField ? bucketRows.map((r) => resolveNested(r, aggField)) : bucketRows
          const value = fn === "count" ? bucketRows.length : aggregateNumeric(fn, values)
          const entry: { date: string; value: number; series?: string } = {
            date: key,
            value,
          }
          if (parsed.groupBy) entry.series = series
          buckets.push(entry)
        }
      }

      return {
        success: true,
        data: {
          buckets,
          row_count: rows.length,
          truncated: rows.length === parsed.fetchLimit,
          precision: parsed.precision,
          from: from.toISOString(),
          to: to.toISOString(),
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
