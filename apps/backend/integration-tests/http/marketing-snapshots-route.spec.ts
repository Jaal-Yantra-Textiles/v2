import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"

jest.setTimeout(60 * 1000)

/**
 * #659 slice 3 PR-3c — read routes over `marketing_metric_snapshot`:
 *   GET /admin/marketing/snapshots  (windowed/filtered list)
 *   GET /admin/marketing/headline   (SWR hero metric + strip + trend)
 *
 * The shared HTTP test DB is TRUNCATEd between it()s, so each test seeds its own
 * snapshot rows via the module service in beforeEach (handoff watch-out).
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  const HEADLINE = "platform_net_gmv"

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    const svc: any = container.resolve(MARKETING_MODULE)
    // Three days of headline GMV + a couple of secondary-strip metrics, all on
    // distinct (metric_key, captured_for_date) pairs (unique index).
    await svc.createMarketingMetricSnapshots([
      { metric_key: HEADLINE, value: 100, unit: "INR", captured_for_date: new Date("2026-06-20T00:00:00.000Z"), delta_dod: null, source: "daily-refresh" },
      { metric_key: HEADLINE, value: 150, unit: "INR", captured_for_date: new Date("2026-06-21T00:00:00.000Z"), delta_dod: 50, source: "daily-refresh" },
      { metric_key: HEADLINE, value: 210, unit: "INR", captured_for_date: new Date("2026-06-22T00:00:00.000Z"), delta_dod: 40, source: "daily-refresh" },
      { metric_key: "orders_count", value: 12, unit: "count", captured_for_date: new Date("2026-06-22T00:00:00.000Z"), source: "daily-refresh" },
      { metric_key: "storefront_sessions", value: 800, unit: "count", captured_for_date: new Date("2026-06-22T00:00:00.000Z"), source: "daily-refresh" },
    ])
  })

  describe("GET /admin/marketing/snapshots", () => {
    it("returns rows newest-first with count and pagination echo", async () => {
      const res = await api.get("/admin/marketing/snapshots", headers)
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(5)
      expect(res.data.limit).toBe(100)
      expect(res.data.offset).toBe(0)
      // newest-first: the most recent captured_for_date leads
      const dates = res.data.snapshots.map((s: any) =>
        new Date(s.captured_for_date).toISOString()
      )
      expect(new Date(dates[0]).getTime()).toBeGreaterThanOrEqual(
        new Date(dates[dates.length - 1]).getTime()
      )
    })

    it("filters by metric_key", async () => {
      const res = await api.get(
        `/admin/marketing/snapshots?metric_key=${HEADLINE}`,
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(3)
      expect(res.data.metric_key).toBe(HEADLINE)
      expect(
        res.data.snapshots.every((s: any) => s.metric_key === HEADLINE)
      ).toBe(true)
    })

    it("honours limit pagination", async () => {
      const res = await api.get("/admin/marketing/snapshots?limit=2", headers)
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(5) // total, not page size
      expect(res.data.snapshots).toHaveLength(2)
    })
  })

  describe("GET /admin/marketing/headline", () => {
    it("returns the newest headline metric + strip + trend", async () => {
      const res = await api.get("/admin/marketing/headline", headers)
      expect(res.status).toBe(200)
      expect(res.data.headline).toMatchObject({
        metric_key: HEADLINE,
        value: 210,
        unit: "INR",
        dod_delta: 40,
      })
      // strip excludes the headline metric, sorted by key
      expect(res.data.strip.map((s: any) => s.metric_key)).toEqual([
        "orders_count",
        "storefront_sessions",
      ])
      // trend is the headline series oldest→newest
      expect(res.data.trend.map((t: any) => t.value)).toEqual([100, 150, 210])
      expect(typeof res.data.stale).toBe("boolean")
      expect(typeof res.data.generated_at).toBe("string")
    })

    it("respects an explicit metric_key override", async () => {
      const res = await api.get(
        "/admin/marketing/headline?metric_key=orders_count",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.headline.metric_key).toBe("orders_count")
      expect(res.data.headline.value).toBe(12)
      expect(res.data.strip.map((s: any) => s.metric_key)).toContain(HEADLINE)
    })
  })
})
