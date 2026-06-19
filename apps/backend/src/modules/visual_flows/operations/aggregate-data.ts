import { z } from "@medusajs/framework/zod"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

type AggregateFn = "count" | "sum" | "avg" | "min" | "max" | "count_distinct"

const rangeSchema = z.union([
  z.object({
    from: z.string().describe("ISO date (inclusive)"),
    to: z.string().describe("ISO date (exclusive)"),
  }),
  z.object({
    last_days: z.number().int().positive().max(3650),
  }),
])

/**
 * Resolve a relative/absolute window to an inclusive-from / exclusive-to pair,
 * aligned to UTC day boundaries so a `last_days: 30` aggregate covers exactly
 * the same 30 daily buckets a sibling `time_series` panel shows. Pure +
 * deterministic given `now`, so it is unit-testable without booting Medusa.
 */
export function resolveRangeWindow(
  range: { from: string; to: string } | { last_days: number },
  now: Date
): { from: string; to: string } {
  if ("last_days" in range) {
    const to = new Date(now)
    to.setUTCHours(0, 0, 0, 0)
    to.setUTCDate(to.getUTCDate() + 1) // exclusive end = start of tomorrow (UTC)
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - range.last_days)
    return { from: from.toISOString(), to: to.toISOString() }
  }
  return {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
  }
}

const aggregateOptionsSchema = z.object({
  entity: z.string().describe("Entity name to query via query.graph"),
  fields: z
    .array(z.string())
    .optional()
    .describe("Fields to fetch from query.graph (required for non-count aggregates and groupBy)"),
  filters: z.record(z.string(), z.any()).optional().describe("Filter conditions"),
  dateField: z
    .string()
    .optional()
    .describe("Date field to bound by when `range` is set. Defaults to created_at."),
  range: rangeSchema
    .optional()
    .describe(
      "Optional date window. `{ last_days: 30 }` (rolling) or `{ from, to }` (absolute). Bounds the aggregation to rows whose dateField falls inside the window."
    ),
  aggregate: z
    .object({
      fn: z
        .enum(["count", "sum", "avg", "min", "max", "count_distinct"])
        .default("count"),
      field: z
        .string()
        .optional()
        .describe("Field to aggregate. Required for all fns except 'count'."),
    })
    .default({ fn: "count" }),
  groupBy: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Field or fields to group by. Returns [{ key, value }]."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cap on groups returned (sorted by value desc)."),
  fetchLimit: z
    .number()
    .int()
    .positive()
    .max(100_000)
    .default(10_000)
    .describe(
      "Max rows to fetch before aggregating in-process. Default 10k. Use daily rollups for large tables."
    ),
  sort: z
    .enum(["asc", "desc"])
    .default("desc")
    .describe("Sort order for groups by value."),
})

function resolveNested(obj: any, path: string): unknown {
  if (obj == null) {
    return undefined
  }
  const parts = path.split(".")
  let current = obj
  for (const part of parts) {
    if (current == null) {
      return undefined
    }
    current = current[part]
  }
  return current
}

function aggregateValues(fn: AggregateFn, values: Array<unknown>): number | null {
  if (fn === "count") {
    return values.length
  }

  if (fn === "count_distinct") {
    const set = new Set<string>()
    for (const v of values) {
      if (v === null || v === undefined) {
        continue
      }
      set.add(String(v))
    }
    return set.size
  }

  const numeric: number[] = []
  for (const v of values) {
    if (v === null || v === undefined || v === "") {
      continue
    }
    const n = typeof v === "number" ? v : Number(v)
    if (!Number.isFinite(n)) {
      continue
    }
    numeric.push(n)
  }

  if (numeric.length === 0) {
    return fn === "sum" ? 0 : null
  }

  switch (fn) {
    case "sum":
      return numeric.reduce((a, b) => a + b, 0)
    case "avg":
      return numeric.reduce((a, b) => a + b, 0) / numeric.length
    case "min":
      return Math.min(...numeric)
    case "max":
      return Math.max(...numeric)
  }

  return null
}

export const aggregateDataOperation: OperationDefinition = {
  type: "aggregate_data",
  name: "Aggregate Data",
  description:
    "Count / sum / avg / min / max / count_distinct over an entity, optionally grouped. Fetches rows via query.graph and aggregates in-process.",
  icon: "chart-pie",
  category: "data",

  optionsSchema: aggregateOptionsSchema,

  defaultOptions: {
    entity: "",
    fields: ["id"],
    filters: {},
    aggregate: { fn: "count" },
    fetchLimit: 10_000,
    sort: "desc",
  },

  execute: async (options: any, context: OperationContext): Promise<OperationResult> => {
    try {
      const entity = interpolateString(options.entity, context.dataChain)
      if (!entity) {
        return { success: false, error: "entity is required for aggregate_data" }
      }

      const parsed = aggregateOptionsSchema.parse({
        ...options,
        entity,
      })

      const fn = parsed.aggregate.fn
      const aggField = parsed.aggregate.field

      if (fn !== "count" && !aggField) {
        return {
          success: false,
          error: `aggregate.field is required when fn is '${fn}'`,
        }
      }

      const groupBy = parsed.groupBy
        ? Array.isArray(parsed.groupBy)
          ? parsed.groupBy
          : [parsed.groupBy]
        : []

      const rawFilters = parsed.filters
        ? interpolateVariables(parsed.filters, context.dataChain)
        : undefined

      const filters: Record<string, any> = {}
      const unresolved: string[] = []
      if (rawFilters && typeof rawFilters === "object") {
        for (const [k, v] of Object.entries(rawFilters)) {
          if (v === undefined || v === null || v === "") {
            unresolved.push(k)
          } else {
            filters[k] = v
          }
        }
      }

      if (unresolved.length > 0) {
        return {
          success: true,
          data: {
            value: fn === "count" ? 0 : null,
            groups: groupBy.length > 0 ? [] : undefined,
            row_count: 0,
            unresolved_filter_keys: unresolved,
            warning: `Filter keys ${JSON.stringify(unresolved)} resolved to null/empty — refusing to query.`,
          },
        }
      }

      // Bound the aggregation to a date window when `range` is set. Without this
      // a metric like "Unique visitors (30 days)" silently aggregates all-time
      // rows. Mirrors the time_series window so sibling panels stay consistent.
      let window: { from: string; to: string } | undefined
      if (parsed.range) {
        const dateField = parsed.dateField || "created_at"
        window = resolveRangeWindow(parsed.range, new Date())
        filters[dateField] = { $gte: window.from, $lt: window.to }
      }

      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)

      const requestedFields = new Set<string>()
      if (parsed.fields?.length) {
        parsed.fields.forEach((f) => requestedFields.add(f))
      }
      if (aggField) {
        requestedFields.add(aggField)
      }
      groupBy.forEach((g) => requestedFields.add(g))
      if (requestedFields.size === 0) {
        requestedFields.add("id")
      }

      const graphOptions: Record<string, any> = {
        entity,
        fields: Array.from(requestedFields),
      }
      if (Object.keys(filters).length > 0) {
        graphOptions.filters = filters
      }
      graphOptions.pagination = { take: parsed.fetchLimit, skip: 0 }

      const result = await query.graph(graphOptions as any)
      const rows: any[] = result?.data || []

      if (groupBy.length === 0) {
        const values = aggField ? rows.map((r) => resolveNested(r, aggField)) : rows
        const value = fn === "count" ? rows.length : aggregateValues(fn, values)
        return {
          success: true,
          data: {
            value,
            row_count: rows.length,
            truncated: rows.length === parsed.fetchLimit,
            ...(window ? { from: window.from, to: window.to } : {}),
          },
        }
      }

      const buckets = new Map<string, any[]>()
      for (const row of rows) {
        const keyParts = groupBy.map((g) => {
          const v = resolveNested(row, g)
          return v === null || v === undefined ? "__null__" : String(v)
        })
        const key = keyParts.join("|")
        if (!buckets.has(key)) {
          buckets.set(key, [])
        }
        buckets.get(key)!.push(row)
      }

      const groups: Array<{ key: string; keys: Record<string, unknown>; value: number | null }> = []
      for (const [key, bucketRows] of buckets.entries()) {
        const values = aggField ? bucketRows.map((r) => resolveNested(r, aggField)) : bucketRows
        const value = fn === "count" ? bucketRows.length : aggregateValues(fn, values)

        const keys: Record<string, unknown> = {}
        groupBy.forEach((g) => {
          keys[g] = resolveNested(bucketRows[0], g)
        })

        groups.push({ key, keys, value })
      }

      groups.sort((a, b) => {
        const av = a.value ?? Number.NEGATIVE_INFINITY
        const bv = b.value ?? Number.NEGATIVE_INFINITY
        return parsed.sort === "desc" ? bv - av : av - bv
      })

      const limited = parsed.limit ? groups.slice(0, parsed.limit) : groups

      return {
        success: true,
        data: {
          groups: limited,
          row_count: rows.length,
          group_count: groups.length,
          truncated: rows.length === parsed.fetchLimit,
          ...(window ? { from: window.from, to: window.to } : {}),
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
