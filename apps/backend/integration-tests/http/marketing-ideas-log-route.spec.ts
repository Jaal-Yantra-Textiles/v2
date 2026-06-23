/**
 * #659 slice 2, PR-5 — admin read route GET /admin/marketing/ideas-log.
 * Seeds `marketing_ideas_log` rows via the module service, then asserts the
 * read route returns them newest-first with a correct roll-up summary and that
 * the `guard_passed` / `sent` boolean filters + pagination work.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  beforeAll(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  // Re-seed before every test: the shared test DB does not retain these rows
  // across tests in this suite, so each test plants its own fixtures.
  beforeEach(async () => {
    const svc: any = getContainer().resolve(MARKETING_MODULE)
    // Three rows on distinct days with distinct guard/sent combinations.
    await svc.createMarketingIdeasLogs({
      generated_for_date: new Date("2026-06-21T00:00:00.000Z"),
      prompt_snapshot: { gmv: 100 },
      output_text: "old idea",
      guard_passed: true,
      sent: true,
      regenerated: false,
    })
    await svc.createMarketingIdeasLogs({
      generated_for_date: new Date("2026-06-23T00:00:00.000Z"),
      prompt_snapshot: { gmv: 200 },
      output_text: "newest idea",
      guard_passed: true,
      sent: false,
      regenerated: true,
    })
    await svc.createMarketingIdeasLogs({
      generated_for_date: new Date("2026-06-22T00:00:00.000Z"),
      prompt_snapshot: { gmv: 150 },
      output_text: "guard-failed idea",
      guard_passed: false,
      sent: false,
      regenerated: false,
    })
  })

  describe("GET /admin/marketing/ideas-log", () => {
    it("lists rows newest-first with a correct summary roll-up", async () => {
      const res = await api.get("/admin/marketing/ideas-log", headers)
      expect(res.status).toBe(200)
      expect(res.data.count).toBeGreaterThanOrEqual(3)

      // newest-first: the 06-23 row precedes the 06-22 and 06-21 rows
      const texts = res.data.ideas_log.map((r: any) => r.output_text)
      const iNew = texts.indexOf("newest idea")
      const iMid = texts.indexOf("guard-failed idea")
      const iOld = texts.indexOf("old idea")
      expect(iNew).toBeGreaterThanOrEqual(0)
      expect(iNew).toBeLessThan(iMid)
      expect(iMid).toBeLessThan(iOld)

      // summary is over the full set
      expect(res.data.summary.total).toBe(res.data.count)
      expect(res.data.summary.guard_passed).toBeGreaterThanOrEqual(2)
      expect(res.data.summary.guard_failed).toBeGreaterThanOrEqual(1)
      expect(res.data.summary.sent).toBeGreaterThanOrEqual(1)
      expect(res.data.summary.regenerated).toBeGreaterThanOrEqual(1)
    })

    it("filters by guard_passed=false", async () => {
      const res = await api.get(
        "/admin/marketing/ideas-log?guard_passed=false",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.count).toBeGreaterThanOrEqual(1)
      for (const row of res.data.ideas_log) {
        expect(row.guard_passed).toBe(false)
      }
      expect(res.data.summary.guard_passed).toBe(0)
    })

    it("filters by sent=true", async () => {
      const res = await api.get(
        "/admin/marketing/ideas-log?sent=true",
        headers
      )
      expect(res.status).toBe(200)
      for (const row of res.data.ideas_log) {
        expect(row.sent).toBe(true)
      }
      expect(res.data.summary.not_sent).toBe(0)
    })

    it("paginates with limit/offset while keeping count over the full set", async () => {
      const res = await api.get(
        "/admin/marketing/ideas-log?limit=1&offset=0",
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.ideas_log.length).toBe(1)
      expect(res.data.limit).toBe(1)
      expect(res.data.offset).toBe(0)
      // count reflects the full filtered set, not the page
      expect(res.data.count).toBeGreaterThanOrEqual(3)
    })
  })
})
