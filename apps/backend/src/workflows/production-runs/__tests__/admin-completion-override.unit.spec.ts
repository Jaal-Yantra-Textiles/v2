/**
 * The admin completion override — the decision that must happen BEFORE a write.
 *
 * #1358 shipped this the other way round: the route stamped `started_at` /
 * `finished_at` / `finish_notes` and THEN called the completion workflow, whose
 * policy gate rejects any status outside `complete_work_from` (prod:
 * `["in_progress"]`). So a rejection was not a no-op — it left the run
 * permanently claiming it had been started and finished at a moment it wasn't,
 * pre-armed to slip past the `finished_at` gate on a later call. And because
 * the status was never promoted, the feature's PRIMARY path (5 prod runs sat in
 * `sent_to_partner` with a partner attached) took that corrupting branch every
 * single time.
 *
 * These cases pin the decision itself: what may be overridden, what may not,
 * and that a refusal names no write to perform.
 */
import {
  evaluateAdminCompletionOverride,
  type OverrideRunLike,
} from "../admin-complete-production-run"

/** Prod's effective policy (the merged config the service returns). */
const PROD_POLICY = {
  transitions: {
    complete_work_from: ["in_progress"],
    accept_from: ["sent_to_partner"],
  },
}

const run = (over: Partial<OverrideRunLike> = {}): OverrideRunLike => ({
  status: "sent_to_partner",
  started_at: null,
  finished_at: null,
  ...over,
})

describe("evaluateAdminCompletionOverride", () => {
  describe("the primary path — the partner never touched the app", () => {
    it("allows a sent_to_partner run and asks for status + both stamps", () => {
      const d = evaluateAdminCompletionOverride(run(), PROD_POLICY)

      expect(d.ok).toBe(true)
      expect(d).toMatchObject({
        promote_status: true,
        stamp_started_at: true,
        stamp_finished_at: true,
      })
    })

    it("does not promote a run that is already in_progress", () => {
      const d = evaluateAdminCompletionOverride(
        run({ status: "in_progress" }),
        PROD_POLICY
      )

      expect(d).toMatchObject({ ok: true, promote_status: false })
    })

    it("leaves timestamps the partner DID record alone", () => {
      const started = new Date("2026-08-01T10:00:00Z")
      const d = evaluateAdminCompletionOverride(
        run({ status: "in_progress", started_at: started }),
        PROD_POLICY
      )

      expect(d).toMatchObject({
        ok: true,
        stamp_started_at: false,
        stamp_finished_at: true,
      })
    })

    it("reports nothing to do for a run already fully staged", () => {
      const d = evaluateAdminCompletionOverride(
        run({
          status: "in_progress",
          started_at: new Date(),
          finished_at: new Date(),
        }),
        PROD_POLICY
      )

      expect(d).toMatchObject({
        ok: true,
        promote_status: false,
        stamp_started_at: false,
        stamp_finished_at: false,
      })
    })
  })

  describe("refusals — these must produce NO write", () => {
    it.each([
      ["draft"],
      ["pending_review"],
      ["approved"],
      ["awaiting_reassignment"],
    ])(
      "refuses %s — the run was never in a partner's hands to attest about",
      (status) => {
        const d = evaluateAdminCompletionOverride(run({ status }), PROD_POLICY)

        expect(d.ok).toBe(false)
        if (d.ok) {
          throw new Error("unreachable")
        }
        expect(d.reason).toContain(status)
        // The refusal must not smuggle a plan back to the caller.
        expect(d).not.toHaveProperty("stamp_finished_at")
      }
    )

    it("refuses a cancelled run", () => {
      const d = evaluateAdminCompletionOverride(
        run({ status: "cancelled" }),
        PROD_POLICY
      )
      expect(d).toMatchObject({ ok: false })
    })

    it("refuses an already-completed run", () => {
      const d = evaluateAdminCompletionOverride(
        run({ status: "completed" }),
        PROD_POLICY
      )
      expect(d).toMatchObject({ ok: false })
    })

    it("refuses a missing run", () => {
      expect(evaluateAdminCompletionOverride(null, PROD_POLICY)).toMatchObject({
        ok: false,
      })
    })
  })

  describe("the policy is the authority, not this function", () => {
    it("honours a widened complete_work_from", () => {
      const d = evaluateAdminCompletionOverride(run({ status: "approved" }), {
        transitions: {
          complete_work_from: ["in_progress", "approved"],
          accept_from: ["sent_to_partner"],
        },
      })

      expect(d).toMatchObject({ ok: true, promote_status: false })
    })

    it("honours a narrowed accept_from — sent_to_partner stops being promotable", () => {
      const d = evaluateAdminCompletionOverride(run(), {
        transitions: {
          complete_work_from: ["in_progress"],
          accept_from: [],
        },
      })

      expect(d).toMatchObject({ ok: false })
    })

    it("falls back to the documented defaults when the config is empty", () => {
      // Prod's stored policy row is missing keys added after it was created —
      // every read falls back per key, so an absent key must behave like prod.
      expect(evaluateAdminCompletionOverride(run(), {})).toMatchObject({
        ok: true,
        promote_status: true,
      })
      expect(
        evaluateAdminCompletionOverride(run({ status: "approved" }), null)
      ).toMatchObject({ ok: false })
    })
  })
})
