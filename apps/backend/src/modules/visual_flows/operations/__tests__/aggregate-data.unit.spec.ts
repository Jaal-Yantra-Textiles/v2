/**
 * Unit tests for the visual-flows `aggregate_data` operation — specifically the
 * `range` date-window contract added for #522.
 *
 * The regression this guards: a "Unique visitors (30 days)" metric panel used
 * `aggregate_data` with `{ fn: "sum", field: "unique_visitors" }` but NO date
 * filter, so it summed all-time daily rollups instead of the trailing 30 days
 * the panel name promised. `aggregate_data` had no relative-window mechanism
 * (only `time_series` did via `range.last_days`). This adds `range` + a
 * `dateField`-bounded filter to the query.graph call.
 *
 * The operation only reads `context.container` + `context.dataChain`, so we can
 * invoke it directly without booting Medusa.
 */

import { aggregateDataOperation, resolveRangeWindow } from "../aggregate-data"

function makeContext(captured: { options?: any }, rows: any[]): any {
  return {
    container: {
      resolve: () => ({
        graph: async (opts: any) => {
          captured.options = opts
          return { data: rows }
        },
      }),
    } as any,
    dataChain: {
      $trigger: { payload: {}, timestamp: "2026-06-19T00:00:00.000Z" },
      $accountability: {},
      $env: {},
      $last: null,
    },
    flowId: "flow_test",
    executionId: "exec_test",
    operationId: "op_test",
    operationKey: "panel",
  }
}

describe("resolveRangeWindow", () => {
  it("aligns a rolling last_days window to UTC day boundaries (exclusive end = start of tomorrow)", () => {
    const now = new Date("2026-06-19T13:45:12.000Z")
    const { from, to } = resolveRangeWindow({ last_days: 30 }, now)
    // exclusive end is start of the day AFTER `now`
    expect(to).toBe("2026-06-20T00:00:00.000Z")
    // inclusive start is exactly 30 days before the exclusive end
    expect(from).toBe("2026-05-21T00:00:00.000Z")
  })

  it("passes through an absolute from/to window normalised to ISO", () => {
    const { from, to } = resolveRangeWindow(
      { from: "2026-01-01", to: "2026-02-01" },
      new Date("2026-06-19T00:00:00.000Z")
    )
    expect(from).toBe("2026-01-01T00:00:00.000Z")
    expect(to).toBe("2026-02-01T00:00:00.000Z")
  })
})

describe("aggregate_data operation — range window", () => {
  it("bounds the query by dateField when range is set", async () => {
    const captured: { options?: any } = {}
    const ctx = makeContext(captured, [
      { unique_visitors: 10 },
      { unique_visitors: 5 },
    ])

    const result = await aggregateDataOperation.execute(
      {
        entity: "analytics_daily_stats",
        aggregate: { fn: "sum", field: "unique_visitors" },
        dateField: "date",
        range: { last_days: 30 },
      },
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.data.value).toBe(15)
    // the date filter reached query.graph
    expect(captured.options.filters).toBeDefined()
    expect(captured.options.filters.date).toBeDefined()
    expect(captured.options.filters.date.$gte).toMatch(/T00:00:00\.000Z$/)
    expect(captured.options.filters.date.$lt).toMatch(/T00:00:00\.000Z$/)
    // the resolved window is echoed back on the result
    expect(result.data.from).toBe(captured.options.filters.date.$gte)
    expect(result.data.to).toBe(captured.options.filters.date.$lt)
  })

  it("defaults dateField to created_at when range is set without dateField", async () => {
    const captured: { options?: any } = {}
    const ctx = makeContext(captured, [{ id: "1" }, { id: "2" }, { id: "3" }])

    const result = await aggregateDataOperation.execute(
      {
        entity: "order",
        aggregate: { fn: "count" },
        range: { last_days: 7 },
      },
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.data.value).toBe(3)
    expect(captured.options.filters.created_at).toBeDefined()
  })

  it("does NOT add a date filter when range is omitted (all-time aggregate preserved)", async () => {
    const captured: { options?: any } = {}
    const ctx = makeContext(captured, [
      { unique_visitors: 1 },
      { unique_visitors: 2 },
    ])

    const result = await aggregateDataOperation.execute(
      {
        entity: "analytics_daily_stats",
        aggregate: { fn: "sum", field: "unique_visitors" },
      },
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.data.value).toBe(3)
    // no range → no filters object forwarded at all
    expect(captured.options.filters).toBeUndefined()
    expect(result.data.from).toBeUndefined()
  })

  it("merges the date window with caller-supplied filters", async () => {
    const captured: { options?: any } = {}
    const ctx = makeContext(captured, [{ id: "1" }])

    await aggregateDataOperation.execute(
      {
        entity: "analytics_daily_stats",
        aggregate: { fn: "count" },
        dateField: "date",
        range: { last_days: 30 },
        filters: { website_id: "web_123" },
      },
      ctx
    )

    expect(captured.options.filters.website_id).toBe("web_123")
    expect(captured.options.filters.date.$gte).toBeDefined()
  })
})
