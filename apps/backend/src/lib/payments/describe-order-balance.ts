import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { planBalanceCollection } from "./balance-collection"
import { reconcileBalanceForSchedule } from "./reconcile-balance"

/**
 * What an order still owes, in the shape the admin AND partner balance cards
 * read. One function for both, so the two surfaces can never disagree about
 * what a buyer has paid.
 */
export const describeOrderBalance = async (scope: any, orderId: string) => {
  const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
  const schedule = await schedules.findByOrderId(orderId).catch(() => null)

  if (!schedule) {
    return {
      has_schedule: false,
      order_id: orderId,
      message:
        "This order has no payment schedule — it was paid in full, so there is no balance to collect.",
    }
  }

  const plan = planBalanceCollection(schedule)

  // The order's SAMPLE runs, so a sample-released deal can be decided from the
  // order page without hunting for run ids. Never fails the read.
  let sampleRuns: Array<Record<string, any>> = []
  if ((schedule.balance_trigger ?? "dispatch") === "sample_approved") {
    try {
      const runs: any = scope.resolve(PRODUCTION_RUNS_MODULE)
      const rows = await runs.listProductionRuns(
        { order_id: orderId, run_type: "sample" },
        { order: { created_at: "ASC" } }
      )
      sampleRuns = (rows ?? []).map((r: any) => ({
        id: r.id,
        status: r.status ?? null,
        partner_id: r.partner_id ?? null,
        quantity: r.quantity ?? null,
        created_at: r.created_at ?? null,
      }))
    } catch {
      sampleRuns = []
    }
  }

  return {
    has_schedule: true,
    order_id: orderId,
    payment_schedule_id: schedule.id,
    currency_code: schedule.currency_code ?? null,
    total_due: Number(schedule.total_due) || null,
    deposit_amount: Number(schedule.deposit_amount) || null,
    deposit_status: schedule.deposit_status ?? null,
    balance_amount: Number(schedule.balance_amount) || null,
    balance_status: schedule.balance_status ?? null,
    balance_due_at: schedule.balance_due_at ?? null,
    /** The link already sent to the buyer, when one has been minted. */
    balance_link: schedule.balance_link_ref ?? null,
    rail: schedule.rail ?? null,
    deposit_pct: schedule.deposit_pct ?? null,
    /** What makes the balance due: dispatch | sample_approved | manual. */
    balance_trigger: schedule.balance_trigger ?? "dispatch",
    sample_approved_at: schedule.sample_approved_at ?? null,
    sample_run_id: schedule.sample_run_id ?? null,
    /** Every verdict on a sample, oldest first. */
    sample_decisions: Array.isArray(schedule.metadata?.sample_decisions)
      ? schedule.metadata.sample_decisions
      : [],
    sample_runs: sampleRuns,
    can_raise: plan.collectable,
    /** Why it cannot be raised, when it cannot. Always populated on a refusal. */
    reason: plan.reason,
    code: plan.collectable ? null : plan.code,
  }
}

/**
 * Reconcile first, then describe. The payment module emits no events, so
 * someone opening the order is a reliable moment to notice money that landed.
 */
export const readOrderBalance = async (scope: any, orderId: string) => {
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByOrderId(orderId).catch(() => null)
    if (schedule?.balance_status === "due") {
      await reconcileBalanceForSchedule(scope, schedule.id)
    }
  } catch {
    /* fall through and describe whatever is stored */
  }
  return describeOrderBalance(scope, orderId)
}
