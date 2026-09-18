import {
  decideReminderAction,
  REMINDER_CAP,
} from "../emit-production-run-reminder"
import { resolveReminderState } from "../reminder-state"

/**
 * #2122 — the bug this file exists for.
 *
 * Reminder state used to be four columns on the run: ONE slot. Two rules that
 * can both be true of the same run at the same time alternate on that slot and
 * reset each other's counter, so neither ever reaches the cap and the partner
 * is nagged forever.
 *
 * The first describe block reproduces that end-to-end against the OLD storage
 * shape, so the failure is on the record rather than described in a comment.
 * The rest pin the new per-rule resolution, including the legacy fallback.
 */

const CAP = REMINDER_CAP

describe("#2122 — the single-slot failure, reproduced", () => {
  it("two concurrent rules alternating on ONE slot never reach the cap", () => {
    // The old model: one bucket on the run, exactly as `decideReminderAction`
    // read it before per-rule rows existed.
    let slot: {
      reminder_kind: string | null
      reminder_count: number
      reminder_status: string | null
    } = { reminder_kind: null, reminder_count: 0, reminder_status: null }

    const actions: string[] = []

    // Ten daily ticks, two rules both true of this run every day.
    for (let day = 0; day < 10; day++) {
      for (const rule of ["idle", "no_consumption_5d"] as const) {
        const { action, nextCount } = decideReminderAction(slot, rule as any)
        actions.push(action)
        if (action === "reminded") {
          slot = {
            reminder_kind: rule,
            reminder_count: nextCount,
            reminder_status: "active",
          }
        }
      }
    }

    // 20 sends, every one of them a nag, and the cap never once bites.
    expect(actions).toHaveLength(20)
    expect(actions.every((a) => a === "reminded")).toBe(true)
    expect(actions).not.toContain("escalated")
    // The counter never gets past 1 — each rule zeroes the other.
    expect(slot.reminder_count).toBe(1)
  })

  it("the same ten days, with a counter per rule, escalates both", () => {
    const rows = new Map<
      string,
      { rule_key: string; reminder_count: number; reminder_status: string | null }
    >()

    const run = { reminder_kind: null, reminder_count: 0, reminder_status: null }
    const actions: string[] = []

    for (let day = 0; day < 10; day++) {
      for (const rule of ["idle", "no_consumption_5d"] as const) {
        const state = resolveReminderState(rows.get(rule) ?? null, run, rule)
        const { action, nextCount } = decideReminderAction(state, rule as any)
        actions.push(action)
        if (action === "reminded") {
          rows.set(rule, {
            rule_key: rule,
            reminder_count: nextCount,
            reminder_status: "active",
          })
        } else if (action === "escalated") {
          rows.set(rule, {
            rule_key: rule,
            reminder_count: nextCount,
            reminder_status: "escalated",
          })
        }
      }
    }

    // Each rule nags up to its own cap, escalates once, then goes quiet —
    // which is the entire contract the cap was written to provide.
    expect(actions.filter((a) => a === "reminded")).toHaveLength(CAP * 2)
    expect(actions.filter((a) => a === "escalated")).toHaveLength(2)
    expect(actions.filter((a) => a === "skipped").length).toBeGreaterThan(0)
    expect(rows.get("idle")?.reminder_status).toBe("escalated")
    expect(rows.get("no_consumption_5d")?.reminder_status).toBe("escalated")
  })
})

describe("resolveReminderState", () => {
  const bareRun = {
    reminder_kind: null,
    reminder_count: 0,
    reminder_status: null,
    last_reminded_at: null,
  }

  it("prefers the per-rule row over the run's columns", () => {
    const run = {
      reminder_kind: "idle",
      reminder_count: 2,
      reminder_status: "active",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
    }
    const row = {
      rule_key: "idle",
      reminder_count: 1,
      reminder_status: "active",
      last_reminded_at: "2026-09-17T00:00:00.000Z",
    }

    expect(resolveReminderState(row, run, "idle")).toEqual({
      reminder_kind: "idle",
      reminder_count: 1,
      reminder_status: "active",
      last_reminded_at: "2026-09-17T00:00:00.000Z",
      from_legacy: false,
    })
  })

  it("falls back to the run's columns when they describe THIS rule", () => {
    const run = {
      reminder_kind: "idle",
      reminder_count: 2,
      reminder_status: "active",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
    }

    expect(resolveReminderState(null, run, "idle")).toEqual({
      reminder_kind: "idle",
      reminder_count: 2,
      reminder_status: "active",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
      from_legacy: true,
    })
  })

  it("a run mid-cycle is NOT restarted at zero by the migration", () => {
    // The point of the fallback: this run has already had both its reminders.
    // Reading it as fresh would hand the partner two more.
    const run = {
      reminder_kind: "idle",
      reminder_count: CAP,
      reminder_status: "active",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
    }

    const state = resolveReminderState(null, run, "idle")
    expect(decideReminderAction(state, "idle" as any)).toEqual({
      action: "escalated",
      nextCount: CAP,
    })
  })

  it("IGNORES the legacy slot when it belongs to a different rule", () => {
    // 🔴 This is the fix. The old code zeroed into the other rule's slot and
    // overwrote it; the new one leaves it alone and starts its own counter.
    const run = {
      reminder_kind: "idle",
      reminder_count: CAP,
      reminder_status: "active",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
    }

    expect(resolveReminderState(null, run, "no_consumption_5d")).toEqual({
      reminder_kind: null,
      reminder_count: 0,
      reminder_status: null,
      last_reminded_at: null,
      from_legacy: false,
    })
  })

  it("a zero count with a null kind is a run that was never reminded", () => {
    // `reminder_count` is integer NOT NULL DEFAULT 0, so 0 is what EVERY run
    // reads — it can never be the discriminator. `reminder_kind` can.
    expect(resolveReminderState(null, bareRun, "idle")).toEqual({
      reminder_kind: null,
      reminder_count: 0,
      reminder_status: null,
      last_reminded_at: null,
      from_legacy: false,
    })
  })

  it("an escalated legacy slot for this rule still reads as escalated", () => {
    const run = {
      reminder_kind: "not_started",
      reminder_count: CAP,
      reminder_status: "escalated",
      last_reminded_at: "2026-09-01T00:00:00.000Z",
    }

    const state = resolveReminderState(null, run, "not_started")
    expect(state.reminder_status).toBe("escalated")
    expect(decideReminderAction(state, "not_started" as any).action).toBe("skipped")
  })

  it("a row with a null count reads as 0 rather than NaN", () => {
    expect(
      resolveReminderState(
        { rule_key: "idle", reminder_count: null, reminder_status: null, last_reminded_at: null },
        bareRun,
        "idle"
      ).reminder_count
    ).toBe(0)
  })
})
