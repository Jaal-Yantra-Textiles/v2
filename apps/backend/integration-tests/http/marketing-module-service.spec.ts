import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"

jest.setTimeout(60 * 1000)

/**
 * #659 slice 1 — the `marketing` module foundation. This slice ships no routes,
 * so we exercise the module service directly: boot the app (which validates the
 * module is registered + its migration ran against the shared test DB), then
 * round-trip one row of each of the 5 models and assert the typed columns,
 * json payloads, enum defaults, and the idempotency-critical unique index.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("marketing module service", () => {
    it("resolves from the container", () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)
      expect(svc).toBeDefined()
      expect(typeof svc.createMarketingMetricSnapshots).toBe("function")
    })

    it("round-trips a metric snapshot with json breakdown + float value", async () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)
      const created = await svc.createMarketingMetricSnapshots({
        metric_key: "platform_gmv",
        value: 12345.67,
        unit: "INR",
        captured_for_date: new Date("2026-06-23T00:00:00.000Z"),
        source: "daily-refresh",
        breakdown: [{ label: "a", value: 1 }],
        delta_dod: -4.5,
      })

      const [rows, count] = await svc.listAndCountMarketingMetricSnapshots({
        id: created.id,
      })
      expect(count).toBe(1)
      expect(rows[0].metric_key).toBe("platform_gmv")
      expect(rows[0].value).toBeCloseTo(12345.67, 1)
      expect(rows[0].breakdown).toEqual([{ label: "a", value: 1 }])
      expect(rows[0].delta_dod).toBeCloseTo(-4.5, 1)
    })

    it("enforces the unique (metric_key, captured_for_date) index", async () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)
      const day = new Date("2026-05-01T00:00:00.000Z")
      await svc.createMarketingMetricSnapshots({
        metric_key: "partner_activations",
        captured_for_date: day,
      })
      await expect(
        svc.createMarketingMetricSnapshots({
          metric_key: "partner_activations",
          captured_for_date: day,
        })
      ).rejects.toBeDefined()
    })

    it("applies enum defaults on outreach (status=queued, channel=email)", async () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)
      const created = await svc.createMarketingOutreaches({
        recipient_email: "winback@example.com",
      })
      expect(created.status).toBe("queued")
      expect(created.channel).toBe("email")
      expect(created.bounce_unreliable).toBe(false)
    })

    it("applies enum defaults on draft (kind=newsletter, status=draft) + json payload", async () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)
      const created = await svc.createMarketingDrafts({
        name: "weekly-2026-06-23",
        payload: { subject: "hi", sections: [] },
      })
      expect(created.kind).toBe("newsletter")
      expect(created.status).toBe("draft")
      expect(created.payload).toEqual({ subject: "hi", sections: [] })
    })

    it("round-trips a manual override and an ideas log", async () => {
      const svc: any = getContainer().resolve(MARKETING_MODULE)

      const override = await svc.createMarketingManualOverrides({
        metric_key: "platform_gmv",
        effective_date: new Date("2026-06-20T00:00:00.000Z"),
        override_value: 999.99,
        reason: "correcting a mis-attributed refund",
        actor_id: "user_test",
      })
      expect(override.active).toBe(true)
      expect(override.reason).toContain("refund")

      const log = await svc.createMarketingIdeasLogs({
        generated_for_date: new Date("2026-06-23T00:00:00.000Z"),
        prompt_snapshot: { gmv: 12345 },
        output_text: "Idea: run a winback campaign.",
      })
      expect(log.guard_passed).toBe(false)
      expect(log.sent).toBe(false)
      expect(log.prompt_snapshot).toEqual({ gmv: 12345 })
    })
  })
})
