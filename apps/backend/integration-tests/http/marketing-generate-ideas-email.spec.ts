import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"
import { generateIdeasEmail } from "../../src/workflows/marketing/generate-ideas-email"

jest.setTimeout(60 * 1000)

/**
 * #659 slice 2, PR-2 — the generate-ideas-email orchestration with a STUBBED
 * LLM (CI never calls a live model). We seed `marketing_metric_snapshot` rows,
 * run `generateIdeasEmail` with an injected `aiGenerate`, and assert:
 *   - a `marketing_ideas_log` row is persisted BEFORE any send (sent=false)
 *   - clean {TOKEN}-only output passes the guard
 *   - a stray-literal output fails the guard and triggers exactly one regenerate
 *   - `prompt_snapshot` (the ground-truth fed in) is stored for replay
 *
 * NOTE: metric_keys are DIGIT-FREE on purpose — the guard's Layer B extracts
 * numeric literals from the RAW output, so a digit inside a {TOKEN} name (e.g.
 * "{Q3_GMV}") would be mis-read as a stray number. The daily-refresh job
 * (slice 3) likewise emits digit-free metric_keys.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("generateIdeasEmail (stubbed LLM)", () => {
    it("persists a guard-passing ideas log without sending", async () => {
      const container = getContainer()
      const svc: any = container.resolve(MARKETING_MODULE)
      // Far-future date so these rows sort newest-first regardless of what
      // other suites seeded into the shared DB.
      const day = new Date("2031-03-01T00:00:00.000Z")
      await svc.createMarketingMetricSnapshots({
        metric_key: "promo_gmv",
        value: 184320,
        unit: "INR",
        captured_for_date: day,
        source: "manual",
        delta_dod: 4.5,
      })
      await svc.createMarketingMetricSnapshots({
        metric_key: "promo_conv",
        value: 0.034,
        unit: "ratio",
        captured_for_date: day,
        source: "manual",
      })

      // Stub references ground-truth ONLY by {TOKEN}; no stray numbers.
      const stub = async () =>
        "Today, lift {PROMO_GMV} (trend {PROMO_GMV_DELTA_DOD}): launch a flash " +
        "sale, spotlight a partner, and nudge carts toward {PROMO_CONV}."

      const res = await generateIdeasEmail(container, {
        aiGenerate: stub,
        oneGoal: "Grow platform GMV.",
        now: new Date("2031-03-01T12:00:00.000Z"),
      })

      expect(res.skipped).toBe(false)
      expect(res.generated).toBe(true)
      expect(res.guard_passed).toBe(true)
      expect(res.regenerated).toBe(false)
      expect(res.log_id).toBeTruthy()
      // placeholders were substituted with display values in the final copy
      expect(res.output_text).toContain("₹1,84,320")
      expect(res.output_text).not.toContain("{PROMO_GMV}")

      const [rows] = await svc.listAndCountMarketingIdeasLogs({ id: res.log_id })
      expect(rows[0].guard_passed).toBe(true)
      expect(rows[0].sent).toBe(false) // persist-before-send
      expect(rows[0].prompt_snapshot.one_goal).toBe("Grow platform GMV.")
      expect(rows[0].prompt_snapshot.date_ist).toBe("2031-03-01")
    })

    it("fails the guard on a stray literal and regenerates exactly once", async () => {
      const container = getContainer()
      const svc: any = container.resolve(MARKETING_MODULE)
      const day = new Date("2031-03-02T00:00:00.000Z")
      await svc.createMarketingMetricSnapshots({
        metric_key: "pushday_gmv",
        value: 50000,
        unit: "INR",
        captured_for_date: day,
        source: "manual",
      })

      let calls = 0
      // Both attempts emit a stray "47%" with no matching ground-truth → fail-closed.
      const stub = async () => {
        calls++
        return "Push hard today: a 47% discount on {PUSHDAY_GMV} should move volume."
      }

      const res = await generateIdeasEmail(container, {
        aiGenerate: stub,
        oneGoal: "Grow platform GMV.",
        now: new Date("2031-03-02T12:00:00.000Z"),
      })

      expect(calls).toBe(2) // generate + one regenerate
      expect(res.regenerated).toBe(true)
      expect(res.guard_passed).toBe(false)

      const [rows] = await svc.listAndCountMarketingIdeasLogs({ id: res.log_id })
      expect(rows[0].guard_passed).toBe(false)
      expect(rows[0].regenerated).toBe(true)
      expect(rows[0].sent).toBe(false)
      expect(Array.isArray(rows[0].guard_failures)).toBe(true)
    })
  })
})
