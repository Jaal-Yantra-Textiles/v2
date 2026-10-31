/**
 * One partner's row on "Who to pay" (#2480): what we owe them, folded from the
 * three answers the payout screens already give.
 *
 *   1. NOT YET BILLED — work (`listPayableRuns`) and goods
 *      (`listPayableInventoryOrders`) that no payout claims yet.
 *   2. BILLED, NOT PAID — `outstanding` from the partner ledger fold.
 *
 * 🔑 Nothing here prices anything. A run's figure is `defaultRunLineAmount`,
 * the same function the create screen bills an untouched row with, and a goods
 * row's figure is the `amount` its own list offers. So "₹4,400 owed" on this
 * screen is ₹4,400 on the payout it prefills.
 *
 * 🔴 What is NOT counted as owed, and why each is still reported:
 *
 *   - `unknown` runs — a live payout for that design never said which run it
 *     paid for, so this run may already be inside it. Summing it into "owed"
 *     is exactly how the same garments get paid for twice. Counted and valued
 *     beside the total as `check_first`, never inside it.
 *   - runs with no price — no agreed rate, or a partly-billed TOTAL run whose
 *     remainder nobody has valued. An absent figure is not ₹0 owed, and it is
 *     not a number either; they are counted as `needs_price`.
 *   - order-backed runs — no design, no rate; the create screen asks a human to
 *     type the figure. Counted as `needs_price` too.
 *
 * PURE, so the arithmetic that decides who gets paid first is testable without
 * a database.
 */

import {
  defaultRunLineAmount,
  defaultRunQuantity,
} from "../../../../workflows/payment_submissions/lib/run-line-pricing"

export type PartnerOwedInput = {
  partner: { id: string; name?: string | null; handle?: string | null; status?: string | null }
  /** `listPayableRuns(...)` for this partner, as returned. */
  runs: {
    payable_runs: any[]
    order_runs: any[]
  }
  /** `listPayableInventoryOrders(...)` for this partner, as returned. */
  inventoryOrders: any[]
  /** `readPartnerLedger(...)` for this partner, as returned. */
  ledger: { entries: any[]; totals: any }
}

export type PartnerOwedRow = {
  partner_id: string
  partner_name: string | null
  partner_handle: string | null
  partner_status: string | null
  /** `unbilled_work + unbilled_goods + billed_unpaid`. The sort key. */
  total_owed: number
  /** Runs a payout could be raised for right now, at the create screen's price. */
  unbilled_work: number
  unbilled_work_count: number
  /** Goods received (or advance due) and not yet claimed. */
  unbilled_goods: number
  unbilled_goods_count: number
  /**
   * Of `unbilled_goods`, orders where money ALREADY recorded against the order
   * meets what is offered. Reported, never subtracted — see
   * `PayableInventoryOrder.recorded_covers_amount`.
   */
  goods_possibly_prepaid_count: number
  /** Payouts raised and not yet settled: ledger `outstanding`. */
  billed_unpaid: number
  unpaid_payout_count: number
  /** Money recorded against what an unpaid payout bills — a double-pay hint. */
  recorded_against_open: number
  /** Runs whose billing history cannot be verified. NOT in `total_owed`. */
  check_first_count: number
  check_first_amount: number
  /** Work done that carries no figure yet. NOT in `total_owed`. */
  needs_price_count: number
  /**
   * The oldest thing still owed: a run's completion, an order's date, or an
   * unpaid payout's submission. Null when nothing is owed.
   */
  oldest_unpaid_at: string | null
  /**
   * Set when anything owed is in a currency other than INR. The ledger has no
   * currency column (every row is rupees), so a mixed total is flagged rather
   * than silently summed as rupees.
   */
  mixed_currency: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = new Date(v as any)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const earliest = (dates: Array<string | null>): string | null =>
  dates.filter(Boolean).sort()[0] ?? null

export const summarizePartnerOwed = (input: PartnerOwedInput): PartnerOwedRow => {
  const { partner, runs, inventoryOrders, ledger } = input
  const dates: Array<string | null> = []

  // ── 1a. WORK not yet billed ────────────────────────────────────────────
  let unbilledWork = 0
  let unbilledWorkCount = 0
  let checkFirstAmount = 0
  let checkFirstCount = 0
  let needsPrice = 0

  for (const run of runs.payable_runs || []) {
    const status = String(run?.billing_status || "")
    if (status === "billed") continue

    const amount = defaultRunLineAmount(run)

    if (status === "unknown") {
      checkFirstCount += 1
      checkFirstAmount += amount
      continue
    }
    if (status !== "clear" && status !== "partly_billed") continue

    if (amount > 0) {
      unbilledWork += amount
      unbilledWorkCount += 1
      dates.push(iso(run.completed_at))
    } else if (defaultRunQuantity(run) > 0) {
      // Units to bill, no figure for them.
      needsPrice += 1
    }
    // Otherwise every unit MADE is already billed — the rest of the order is
    // not made yet, so nothing is owed and nothing needs a price.
  }

  /**
   * An order-backed group is unbilled until a live line names its runs. It
   * carries no figure (the create screen makes a human type one), so it is a
   * `needs_price`, never an amount.
   */
  for (const group of runs.order_runs || []) {
    if (group?.billing_status === "billed") continue
    needsPrice += 1
  }

  // ── 1b. GOODS not yet billed ───────────────────────────────────────────
  let unbilledGoods = 0
  let unbilledGoodsCount = 0
  let prepaidCount = 0
  let mixedCurrency = false

  for (const order of inventoryOrders || []) {
    if (!order?.payable) continue
    const amount = num(order.amount)
    if (amount <= 0) continue
    unbilledGoods += amount
    unbilledGoodsCount += 1
    if (order.recorded_covers_amount) prepaidCount += 1
    const currency = String(order.currency_code || "inr").toLowerCase()
    if (currency !== "inr") mixedCurrency = true
    dates.push(iso(order.order_date))
  }

  // ── 2. BILLED, NOT PAID ────────────────────────────────────────────────
  const totals = ledger?.totals || {}
  const billedUnpaid = num(totals.outstanding)
  if (totals.currency && String(totals.currency).toLowerCase() !== "inr") {
    mixedCurrency = true
  }

  let unpaidPayouts = 0
  for (const entry of ledger?.entries || []) {
    if (entry?.kind !== "payout") continue
    if (entry.status === "Rejected" || entry.status === "Paid") continue
    const left =
      num(entry.amount) - num(entry.settled_amount) - num(entry.credited_amount)
    if (left <= 0) continue
    unpaidPayouts += 1
    dates.push(iso(entry.submitted_at) || iso(entry.occurred_at))
  }

  const total = unbilledWork + unbilledGoods + billedUnpaid

  return {
    partner_id: String(partner.id),
    partner_name: partner.name ?? null,
    partner_handle: partner.handle ?? null,
    partner_status: partner.status ?? null,
    total_owed: round2(total),
    unbilled_work: round2(unbilledWork),
    unbilled_work_count: unbilledWorkCount,
    unbilled_goods: round2(unbilledGoods),
    unbilled_goods_count: unbilledGoodsCount,
    goods_possibly_prepaid_count: prepaidCount,
    billed_unpaid: round2(billedUnpaid),
    unpaid_payout_count: unpaidPayouts,
    recorded_against_open: round2(num(totals.recorded_against_open)),
    check_first_count: checkFirstCount,
    check_first_amount: round2(checkFirstAmount),
    needs_price_count: needsPrice,
    oldest_unpaid_at: earliest(dates),
    mixed_currency: mixedCurrency,
  }
}

/** Whether a row belongs on the screen at all: money owed, or work to look at. */
export const partnerNeedsAttention = (row: PartnerOwedRow): boolean =>
  row.total_owed > 0 || row.check_first_count > 0 || row.needs_price_count > 0

/**
 * Most owed first; then rows with no money but something to look at; ties by
 * whoever has waited longest.
 */
export const comparePartnersOwed = (a: PartnerOwedRow, b: PartnerOwedRow): number => {
  if (b.total_owed !== a.total_owed) return b.total_owed - a.total_owed
  const aWait = a.oldest_unpaid_at || "9999"
  const bWait = b.oldest_unpaid_at || "9999"
  return aWait.localeCompare(bWait)
}
