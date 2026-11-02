import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import {
  settleBalance,
  summariseBalancePayments,
  type BalancePaymentState,
} from "./balance-collection"

/**
 * Find the balance's payment collection on an order, and decide whether the
 * money has landed.
 *
 * ## 🔴 How the balance collection is identified
 *
 * NOT by a metadata marker. `createOrUpdateOrderPaymentCollectionWorkflow` —
 * core's own workflow, which this now uses — creates the collection itself and
 * writes no marker of ours. Identifying it is therefore done the way core
 * identifies it: the DEPOSIT's collection is `completed`, and the outstanding
 * one is not. Core's own filter uses exactly that distinction.
 *
 * ⚠️ Do not pick "the first collection" or "the newest". An order carries both,
 * and picking the deposit's would reconcile the balance against A$94.43 that
 * was received for something else — and close a debt that is still owed.
 *
 * ## Why reconcile at all
 *
 * `@medusajs/payment` emits no events, so there is no capture to subscribe to.
 * Both the buyer's return to the payment page and the maintenance sweep call
 * this one function, so the fast path and the backstop cannot disagree.
 */
export type BalanceReconciliation = {
  schedule_id: string
  /** True only when this call moved the schedule to `paid`. */
  marked_paid: boolean
  /** True when it was already `paid` before this ran. */
  already_paid: boolean
  expected: number | null
  state: BalancePaymentState | null
  payment_collection_id: string | null
  reason: string
}

/**
 * The order's OUTSTANDING balance collection: not `completed` (the deposit's
 * is), preferring the one whose amount matches the balance to the cent.
 * Shared by the reconcile sweep and the PayU balance webhook so the two can
 * never pick different collections.
 */
export const pickOutstandingBalanceCollection = (
  collections: any[],
  expected: number
): any | undefined =>
  collections.find(
    (c) =>
      c?.status !== "completed" &&
      Number.isFinite(Number(c?.amount)) &&
      Math.round(Number(c.amount) * 100) === Math.round(expected * 100)
  ) ?? collections.find((c) => c?.status !== "completed")

/**
 * The balance's collection by amount, INCLUDING one already `completed`.
 *
 * 🔴 Core marks a collection `completed` the moment its captures reach its
 * amount — so a balance paid in full looks, by status alone, exactly like the
 * deposit's, and `pickOutstandingBalanceCollection` skips it. Reconcile then
 * never saw the payment it exists to record (found by the #101 integration test,
 * 2026-11-03). The deposit is told apart by what it IS — the checkout's
 * collection, linked to the cart — not by its status.
 *
 * Returns undefined when no cart link is found: without knowing which
 * collection is the deposit, a completed one of the same amount (a 50% deposit)
 * cannot safely be called the balance.
 */
async function pickBalanceCollectionByAmount(
  container: any,
  collections: any[],
  expected: number
): Promise<any | undefined> {
  if (!Number.isFinite(expected) || !collections.length) return undefined
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: cartLinks } = await query
    .graph({
      entity: "cart_payment_collection",
      fields: ["payment_collection_id"],
      filters: { payment_collection_id: collections.map((c) => c.id) },
    })
    .catch(() => ({ data: [] }))
  const depositIds = new Set(((cartLinks ?? []) as any[]).map((l) => l.payment_collection_id))
  if (!depositIds.size) return undefined
  return collections.find(
    (c) =>
      !depositIds.has(c.id) &&
      c?.status !== "canceled" &&
      Number.isFinite(Number(c?.amount)) &&
      Math.round(Number(c.amount) * 100) === Math.round(expected * 100)
  )
}

export async function reconcileBalanceForSchedule(
  container: any,
  scheduleId: string
): Promise<BalanceReconciliation> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

  let schedule: any
  try {
    schedule = await schedules.retrievePaymentSchedule(scheduleId)
  } catch {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: false,
      expected: null,
      state: null,
      payment_collection_id: null,
      reason: "No such payment schedule.",
    }
  }

  if (schedule.balance_status === "paid") {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: true,
      expected: Number(schedule.balance_amount) || null,
      state: null,
      payment_collection_id: null,
      reason: "The balance was already recorded as paid.",
    }
  }

  if (!schedule.order_id) {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: false,
      expected: null,
      state: null,
      payment_collection_id: null,
      reason: "The schedule has no order, so there is nothing to reconcile against.",
    }
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "payment_collections.id",
      "payment_collections.amount",
      "payment_collections.status",
      "payment_collections.currency_code",
      "payment_collections.payments.amount",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.canceled_at",
      "payment_collections.payments.refunded_total",
    ],
    filters: { id: schedule.order_id },
  })

  const collections = ((orders?.[0] as any)?.payment_collections ?? []) as any[]

  const expected = Number(schedule.balance_amount)

  /**
   * Prefer a non-completed collection whose amount matches the balance to the
   * cent. Amount is the tie-breaker rather than the sole test, because two
   * collections could in principle share a status — and matching on money is
   * what makes "this is the balance" defensible.
   */
  const candidate =
    (await pickBalanceCollectionByAmount(container, collections, expected)) ??
    pickOutstandingBalanceCollection(collections, expected)

  if (!candidate) {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: false,
      expected: Number.isFinite(expected) ? expected : null,
      state: null,
      payment_collection_id: null,
      reason:
        "No outstanding payment collection on this order — the balance has not been raised yet.",
    }
  }

  const state = summariseBalancePayments(candidate)

  /**
   * 🔴 Settle only against a collection raised for THIS balance. The fallback
   * pick above can land on an older balance collection of a different amount —
   * order #101 (2026-11-02) part-paid 220.34 on a 347.36 collection, and once
   * its schedule moved to the 127.02 still owed, that 220.34 would otherwise
   * read as "captured ≥ expected" and close a debt nobody had paid.
   */
  if (Math.round(Number(candidate.amount) * 100) !== Math.round(expected * 100)) {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: false,
      expected: Number.isFinite(expected) ? expected : null,
      state,
      payment_collection_id: candidate.id,
      reason: `The outstanding collection is for ${candidate.amount} but the balance is ${expected}; not settling on a collection raised for another amount.`,
    }
  }

  const verdict = settleBalance(schedule.balance_amount, state)

  if (!verdict.settled) {
    return {
      schedule_id: scheduleId,
      marked_paid: false,
      already_paid: false,
      expected: Number.isFinite(expected) ? expected : null,
      state,
      payment_collection_id: candidate.id,
      reason: verdict.reason,
    }
  }

  await schedules.markBalancePaid(scheduleId, candidate.id)

  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  // Always on: the line that says the second half of a deal was received.
  logger?.info?.(
    `[balance] schedule=${scheduleId} order=${schedule.order_id} PAID — captured ${state.captured} against ${expected}`
  )

  return {
    schedule_id: scheduleId,
    marked_paid: true,
    already_paid: false,
    expected,
    state,
    payment_collection_id: candidate.id,
    reason: verdict.reason,
  }
}
