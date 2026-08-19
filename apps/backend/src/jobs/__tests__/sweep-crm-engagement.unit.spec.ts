import sweepCrmEngagement, { config } from "../sweep-crm-engagement"
import { crmEngagementSweepJob } from "../../api/admin/ops/maintenance-jobs/crm-engagement-sweep-job"

/**
 * #1355 — the CRM's only clock, and it was never wound.
 *
 * `crm-engagement-sweep` is the sole emitter of `crm.follow_up_due`,
 * `crm.contact_stalled`, `crm.contact_replied` and `crm.contact_opted_out`.
 * With no schedule, not one of those events could ever fire, so every visual
 * flow triggering on `crm.*` was inert — and inert in the worst way, looking
 * exactly like a flow whose condition simply never matched. 230 leads were
 * imported and `/admin/crm/activities` returned `count: 0`.
 *
 * These cases pin the properties that decide whether that can recur: it must
 * fire on its own, it must apply rather than rehearse, it must not go quiet
 * when it fails, and it must not be a divergent copy of the operator's
 * on-demand job.
 */

const logger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
})

const containerWith = (log = logger()) =>
  ({ resolve: jest.fn().mockReturnValue(log) }) as any

describe("sweep-crm-engagement (scheduled)", () => {
  afterEach(() => jest.restoreAllMocks())

  describe("it fires on its own", () => {
    it("declares a schedule — an unscheduled sweep is the whole defect", () => {
      expect(config.schedule).toBeTruthy()
      // 5 cron fields.
      expect(String(config.schedule).trim().split(/\s+/)).toHaveLength(5)
    })

    it("runs at most once a day — the states it finds are day-scale", () => {
      const [minute, hour] = String(config.schedule).split(/\s+/)
      expect(minute).not.toBe("*")
      expect(hour).not.toBe("*")
    })

    it("is named, so it is identifiable in the scheduler", () => {
      expect(config.name).toBe("sweep-crm-engagement")
    })
  })

  describe("it applies, and it is the same job the operator runs", () => {
    it("delegates to the registered maintenance job rather than a copy", async () => {
      const run = jest
        .spyOn(crmEngagementSweepJob, "run")
        .mockResolvedValue({
          job_id: "crm-engagement-sweep",
          dry_run: false,
          applied: true,
          summary: "3 contacts transitioned",
          changes: [],
        })

      await sweepCrmEngagement(containerWith())

      expect(run).toHaveBeenCalledTimes(1)
    })

    it("applies — a scheduled dry run would emit nothing and look healthy", async () => {
      const run = jest
        .spyOn(crmEngagementSweepJob, "run")
        .mockResolvedValue({
          job_id: "crm-engagement-sweep",
          dry_run: false,
          applied: false,
          summary: "no transitions",
          changes: [],
        })

      await sweepCrmEngagement(containerWith())

      expect(run.mock.calls[0][1]).toMatchObject({ dry_run: false })
    })
  })

  describe("it does not fail quietly", () => {
    it("logs the summary of a successful sweep", async () => {
      jest.spyOn(crmEngagementSweepJob, "run").mockResolvedValue({
        job_id: "crm-engagement-sweep",
        dry_run: false,
        applied: true,
        summary: "4 contacts transitioned",
        changes: [],
      })
      const log = logger()

      await sweepCrmEngagement(containerWith(log))

      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("4 contacts transitioned")
      )
    })

    it("surfaces per-contact errors the job collected instead of threw", async () => {
      jest.spyOn(crmEngagementSweepJob, "run").mockResolvedValue({
        job_id: "crm-engagement-sweep",
        dry_run: false,
        applied: true,
        summary: "1 contact transitioned",
        changes: [],
        errors: [{ id: "per_1", message: "boom" }],
      })
      const log = logger()

      await sweepCrmEngagement(containerWith(log))

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("per_1"))
    })

    it("swallows a thrown sweep but records it as an error", async () => {
      jest
        .spyOn(crmEngagementSweepJob, "run")
        .mockRejectedValue(new Error("CRM store locked"))
      const log = logger()

      // Must not reject — one bad night cannot take the scheduler down.
      await expect(sweepCrmEngagement(containerWith(log))).resolves.toBeUndefined()
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("CRM store locked")
      )
    })
  })
})
