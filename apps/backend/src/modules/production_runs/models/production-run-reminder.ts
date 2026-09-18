import { model } from "@medusajs/framework/utils"

/**
 * #2122 — reminder state, ONE ROW PER (run, rule).
 *
 * 🔴 Why this table exists at all. Until now the whole reminder state machine
 * lived in four columns on `production_run`:
 *
 *     reminder_count / reminder_kind / last_reminded_at / reminder_status
 *
 * which is a SINGLE SLOT. `decideReminderAction` reads
 * `sameBucket = run.reminder_kind === kind` and zeroes the count when the kind
 * differs. That is correct for the four built-in kinds, because they are
 * STAGES a run passes through in sequence — a run is `assignment_pending` or
 * `not_started` or `idle`, never two at once.
 *
 * Free-form rules break that premise. The moment two rules can both be true of
 * one run — say `idle` and `no consumption logged in 5 days` — they alternate
 * on the same four columns, each resetting the other's counter. The cap is
 * never reached, the escalation never fires, and **the partner is nagged
 * forever**: a worse failure than the one the cap exists to prevent.
 *
 * So the slot becomes a row. Each rule counts on its own.
 *
 * ## The legacy columns stay, as a fallback read
 *
 * Rows that predate this table have their state only in the run's columns, and
 * a run mid-cycle must not silently restart at zero — that hands a partner two
 * extra nags.
 *
 * 🔑 The discriminator is `reminder_kind`, NOT `reminder_count`.
 * `reminder_count` is `integer NOT NULL DEFAULT 0` (verified in
 * `.snapshot-production-runs.json`, not the DML), so "count is unset" is
 * unrepresentable — every row reads 0 and a `count == null` fallback would be
 * dead code that quietly always says "nothing recorded". `reminder_kind` is
 * genuinely `nullable`, so `run.reminder_kind === rule_key` is a real signal
 * that the legacy slot is describing THIS rule.
 *
 * The emitter dual-writes both while the fallback matters; the run's columns
 * remain what the admin timeline and activity recorder read.
 */
const ProductionRunReminder = model
  .define("production_run_reminder", {
    id: model.id({ prefix: "prun_rem" }).primaryKey(),

    production_run_id: model.text().searchable(),

    /**
     * Which rule is counting. Free-form on purpose — the four built-in kinds
     * (`assignment_pending`, `not_started`, `idle`, `awaiting_reassignment`)
     * are simply the rule keys that exist today, and a data-driven rule brings
     * its own. Deliberately NOT an enum: an enum here would put the closed
     * union back, one layer down.
     */
    rule_key: model.text(),

    /** Reminders SENT for this rule. Compared against the rule's own cap. */
    reminder_count: model.number().default(0),

    /**
     * Cycle lifecycle for THIS rule only.
     *   active    — reminding
     *   escalated — cap reached and handed off; do not nag or re-escalate
     *   closed    — the rule stopped applying (reassignment, reset)
     */
    reminder_status: model
      .enum(["active", "escalated", "closed"])
      .nullable(),

    /** When this rule last fired. The parked-run cadence reads it back. */
    last_reminded_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      // One counter per rule per run — the whole point of the table.
      on: ["production_run_id", "rule_key"],
      unique: true,
    },
  ])

export default ProductionRunReminder
