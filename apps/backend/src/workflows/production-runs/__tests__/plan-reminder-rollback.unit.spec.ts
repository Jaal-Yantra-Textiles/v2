import { planReminderRollback } from "../emit-production-run-reminder"

/**
 * #1279 — the cap counted attempts Meta refused.
 *
 * 132 reminders failed with `131053` (oversized design image) between 2026-04
 * and 2026-08, and every one still incremented `reminder_count`. Runs reached
 * the cap and were parked into `awaiting_reassignment` — the state nothing
 * watches — without the partner ever having been asked. A reminder Meta
 * refused was never a reminder.
 */

const RUN = "prod_run_01KMYY7XVR6XVHW39YXMY6CKX0"

const reminderMsg = (over: Record<string, any> = {}) => ({
  status: "sent",
  context_type: "production_run",
  context_id: `${RUN}:reminder:2026-04-25`,
  ...over,
})

describe("planReminderRollback", () => {
  it("un-counts a reminder Meta refused", () => {
    expect(planReminderRollback(reminderMsg(), "failed")).toEqual({
      production_run_id: RUN,
    })
  })

  it("leaves delivered and read alone", () => {
    expect(planReminderRollback(reminderMsg(), "delivered")).toBeNull()
    expect(planReminderRollback(reminderMsg(), "read")).toBeNull()
    expect(planReminderRollback(reminderMsg(), "sent")).toBeNull()
  })

  it("does not decrement twice for one message — Meta repeats statuses", () => {
    // The webhook re-applies `failed` by design. Counting it again would
    // under-count and nag the partner forever.
    expect(planReminderRollback(reminderMsg({ status: "failed" }), "failed")).toBeNull()
  })

  it("ignores a failed DISPATCH — only reminders touch the cap", () => {
    expect(
      planReminderRollback(
        reminderMsg({ context_id: `${RUN}:sent_to_partner:2026-04-25` }),
        "failed"
      )
    ).toBeNull()
  })

  it("ignores a message about something other than a production run", () => {
    expect(
      planReminderRollback(
        reminderMsg({ context_type: "inventory_order" }),
        "failed"
      )
    ).toBeNull()
  })

  it("ignores a message with no context at all — the old rows carry none", () => {
    expect(
      planReminderRollback({ status: "sent", context_type: null, context_id: null }, "failed")
    ).toBeNull()
    expect(planReminderRollback({}, "failed")).toBeNull()
  })

  it("reads the run id off the real prod context shape", () => {
    // Verbatim from a failed prod row: "<run_id>:reminder:<date>".
    const actual = "prod_run_01KMYY7XVR6XVHW39YXMY6CKX0:reminder:2026-04-25"
    expect(
      planReminderRollback({ status: "sent", context_type: "production_run", context_id: actual }, "failed")
    ).toEqual({ production_run_id: "prod_run_01KMYY7XVR6XVHW39YXMY6CKX0" })
  })
})
