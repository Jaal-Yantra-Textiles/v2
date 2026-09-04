import { PAYMENT_SCHEDULE_MODULE } from "../../../../modules/payment_schedule"
import { reconcileBalanceForSchedule } from "../../../../lib/payments/reconcile-balance"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Close out balances that have been paid but never recorded (#1451 follow-on).
 *
 * ## 🔴 Why a sweep and not a subscriber
 *
 * `@medusajs/payment` does not reference the event bus at all — it emits
 * nothing. There is no `payment.captured` to subscribe to, so a handler written
 * against one would never fire, and a balance would sit `due` forever while the
 * money was already in the account. The deposit escapes this only because
 * `order.placed` happens to exist.
 *
 * The buyer returning to the payment page reconciles on the spot and is the
 * fast path. This is the backstop for everyone who pays and closes the tab, and
 * for any redirect that never comes back. Both call the SAME function, so they
 * cannot reach different conclusions about the same money.
 *
 * Read-mostly and idempotent: a schedule already `paid` is skipped, a partial
 * capture is deliberately left `due`, and an authorisation is not money.
 */
const DEFAULT_LIMIT = 500

function numParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const reconcileOrderBalancesJob: MaintenanceJob = {
  id: "reconcile-order-balances",
  label: "Reconcile paid order balances",
  description:
    "Walk payment schedules whose balance is `due`, read what their order's outstanding payment collection actually captured, and mark the schedule paid when the full amount has landed. Exists because the payment module emits no events — nothing announces a capture, so a balance can be paid by the buyer and stay `due` in our ledger indefinitely. A partial capture is left `due` on purpose ('mostly paid' is not paid), and an authorisation is not counted (a hold is not money received). Dry-run reports what would change and writes nothing.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Maximum schedules to examine (default ${DEFAULT_LIMIT}).`,
    },
    {
      name: "schedule_id",
      type: "string",
      required: false,
      description: "Reconcile one schedule only, for checking a specific order.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    const limit = numParam(params?.limit, DEFAULT_LIMIT)
    const only = params?.schedule_id ? String(params.schedule_id) : null

    const rows: any[] = only
      ? await schedules
          .listPaymentSchedules({ id: only })
          .catch(() => [])
      : await schedules
          .listPaymentSchedules({ balance_status: "due" }, { take: limit })
          .catch(() => [])

    const changes: MaintenanceChange[] = []
    let settled = 0
    let outstanding = 0

    for (const row of rows) {
      /**
       * ⚠️ Dry-run must not call the reconciler: it WRITES when it settles.
       * Reporting "would mark paid" here means reading the same evidence
       * without acting — otherwise `dry_run: true` would quietly close
       * balances, which is the opposite of what an operator asked for.
       */
      if (dry_run) {
        changes.push({
          entity: "payment_schedule",
          id: row.id,
          before: { balance_status: row.balance_status },
          after: { balance_status: "would be checked against captured payments" },
        } as MaintenanceChange)
        continue
      }

      const rec = await reconcileBalanceForSchedule(container, row.id).catch(
        (e: any) => ({
          schedule_id: row.id,
          marked_paid: false,
          already_paid: false,
          expected: null,
          state: null,
          payment_collection_id: null,
          reason: `Reconcile failed: ${e?.message ?? e}`,
        })
      )

      if (rec.marked_paid) {
        settled += 1
        changes.push({
          entity: "payment_schedule",
          id: row.id,
          before: { balance_status: "due" },
          after: {
            balance_status: "paid",
            captured: rec.state?.captured ?? null,
            expected: rec.expected,
          },
        } as MaintenanceChange)
      } else {
        outstanding += 1
      }
    }

    return {
      job_id: reconcileOrderBalancesJob.id,
      dry_run,
      applied: !dry_run && settled > 0,
      summary: dry_run
        ? `${rows.length} schedule(s) with a due balance would be checked against their captured payments.`
        : `Checked ${rows.length} due balance(s): ${settled} marked paid, ${outstanding} still outstanding.`,
      changes,
    }
  },
}

export default reconcileOrderBalancesJob
