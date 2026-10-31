import {
  formatMoney,
  readAmount,
} from "../../workflows/email/workflows/order-edit-confirmed-email-lib"
import type { BalanceSchedule } from "./balance-collection"

/**
 * Pure pieces of the customer invoice (#2480): bring a deposit schedule back in
 * line with its order, and the flat variables the `order-invoice` template
 * renders.
 *
 * ## Why a resync exists
 *
 * The schedule records the split agreed at checkout. An order edit afterwards
 * (order #101, 2026-10-31: two robes, two tunics added) moves the ORDER's total
 * and pending difference but leaves the schedule's `balance_amount` where it
 * was. The balance workflow then refuses — correctly — because the two
 * disagree, and the hosted pay page would look for a collection of the OLD
 * amount. Nobody had a way to say "the edit was deliberate; bill the order".
 */

const cents = (n: number) => Math.round(n * 100)

export type ScheduleResyncPlan =
  | { action: "noop"; reason: string }
  | {
      action: "resync"
      schedule_id: string
      total_due: number
      balance_amount: number
      previous: { total_due: number | null; balance_amount: number | null }
      reason: string
    }
  | { action: "refuse"; reason: string }

/**
 * PURE: should the schedule be moved to the order's numbers, and to what.
 *
 * Only the BALANCE moves. The deposit is money already taken for an agreed
 * amount, so the resync is refused unless what the order says was paid is
 * exactly that deposit — anything else (a part-paid balance, an extra capture,
 * a refund) is a state this does not reason about.
 */
export function planScheduleResync(input: {
  schedule: (BalanceSchedule & { deposit_status?: string | null }) | null | undefined
  order: {
    currency_code?: string | null
    total?: unknown
    summary?: { pending_difference?: unknown; paid_total?: unknown } | null
  }
}): ScheduleResyncPlan {
  const { schedule, order } = input
  if (!schedule) {
    return { action: "noop", reason: "No payment schedule on this order." }
  }
  if (schedule.balance_status === "paid" || schedule.balance_status === "waived") {
    return { action: "noop", reason: `The balance is already ${schedule.balance_status}.` }
  }
  if (schedule.deposit_status !== "paid" && schedule.deposit_status !== "waived") {
    return {
      action: "refuse",
      reason: `The deposit is ${schedule.deposit_status ?? "unknown"}, so there is no balance to bill yet.`,
    }
  }
  if (
    schedule.currency_code &&
    order.currency_code &&
    schedule.currency_code.toLowerCase() !== order.currency_code.toLowerCase()
  ) {
    return {
      action: "refuse",
      reason: `The schedule is in ${schedule.currency_code} but the order is in ${order.currency_code}.`,
    }
  }

  const total = readAmount(order.total)
  const pending = readAmount(order.summary?.pending_difference)
  const paid = readAmount(order.summary?.paid_total) ?? 0
  const deposit = readAmount(schedule.deposit_amount) ?? 0
  const scheduledBalance = readAmount(schedule.balance_amount)
  const scheduledTotal = readAmount(schedule.total_due)

  if (total === null || pending === null) {
    return { action: "refuse", reason: "The order reports no total or pending difference." }
  }
  if (cents(pending) <= 0) {
    return { action: "noop", reason: "Nothing is outstanding on the order." }
  }
  if (
    scheduledBalance !== null &&
    scheduledTotal !== null &&
    cents(scheduledBalance) === cents(pending) &&
    cents(scheduledTotal) === cents(total)
  ) {
    return { action: "noop", reason: "The schedule already matches the order." }
  }
  if (cents(paid) !== cents(deposit)) {
    return {
      action: "refuse",
      reason: `The order shows ${paid} paid but the deposit was ${deposit}; reconcile payments before rebilling the balance.`,
    }
  }
  if (cents(deposit + pending) !== cents(total)) {
    return {
      action: "refuse",
      reason: `Deposit ${deposit} + outstanding ${pending} does not make the order total ${total}.`,
    }
  }

  return {
    action: "resync",
    schedule_id: schedule.id,
    total_due: total,
    balance_amount: pending,
    previous: { total_due: scheduledTotal, balance_amount: scheduledBalance },
    reason: `Balance ${scheduledBalance ?? "—"} → ${pending} to match the edited order (total ${total}).`,
  }
}

export type OrderInvoiceLine = {
  title: string
  variant: string
  quantity: number
  unit_price: string
  line_total: string
  note: string
}

export type OrderInvoiceVars = {
  customer_first_name: string
  order_display_id: string | number
  lines: OrderInvoiceLine[]
  subtotal: string
  shipping: string
  order_total: string
  paid: string
  /** Empty string when nothing is owed, so `{{#if balance_due}}` hides the block. */
  balance_due: string
  pay_url: string
  current_year: number
  order_id: string
  currency_code: string
}

/**
 * PURE: the FLAT variables the `order-invoice` template declares — flat for the
 * same reason as `buildOrderEditConfirmedVars` (a missing nested key renders
 * as nothing and says nothing).
 *
 * A zero-priced line keeps its row and reads "No charge", so a replacement sent
 * free is visible on the invoice rather than silently absent.
 */
export function buildOrderInvoiceVars(input: {
  order: any
  pay_url?: string | null
  now?: Date
}): OrderInvoiceVars {
  const { order } = input
  const currency = order?.currency_code ?? null
  const money = (v: unknown) => {
    const n = readAmount(v)
    return n === null ? "" : formatMoney(n, currency)
  }

  const firstName =
    order?.shipping_address?.first_name ||
    order?.billing_address?.first_name ||
    order?.customer?.first_name ||
    (order?.email ? String(order.email).split("@")[0] : "") ||
    "there"

  const lines: OrderInvoiceLine[] = (order?.items ?? []).map((item: any) => {
    const unit = readAmount(item?.unit_price) ?? 0
    const qty = readAmount(item?.quantity) ?? 0
    const variant = String(item?.variant_title ?? "").trim()
    return {
      title: String(item?.product_title || item?.title || "Item"),
      variant: variant && variant !== "Default variant" ? variant : "",
      quantity: qty,
      unit_price: cents(unit) === 0 ? "No charge" : formatMoney(unit, currency),
      line_total: cents(unit * qty) === 0 ? "No charge" : formatMoney(unit * qty, currency),
      note: cents(unit) === 0 ? "Replacement, sent at no charge" : "",
    }
  })

  const pending = readAmount(order?.summary?.pending_difference)
  const due = pending !== null && cents(pending) > 0 ? formatMoney(pending, currency) : ""

  return {
    customer_first_name: firstName,
    order_display_id: order?.display_id ?? "",
    lines,
    subtotal: money(order?.item_total ?? order?.subtotal),
    shipping: money(order?.shipping_total),
    order_total: money(order?.total),
    paid: money(order?.summary?.paid_total ?? 0),
    balance_due: due,
    pay_url: due ? String(input.pay_url ?? "") : "",
    current_year: (input.now ?? new Date()).getFullYear(),
    order_id: order?.id ?? "",
    currency_code: String(currency ?? "").toUpperCase(),
  }
}
