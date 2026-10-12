/**
 * #2322 — what a partner owes us on a run they made with our material.
 *
 *   owed    = Σ(sold qty × gross unit price) × percent / 100
 *   balance = owed − Σ(payments recorded)
 *
 * Pure: the route reads rows and hands them here, so the arithmetic is tested
 * without a database. Nothing here is stored — a corrected sale corrects what
 * is owed.
 *
 * 🔑 `null` is not `0`. A run with no agreement has `owed: null` ("nothing is
 * owed because there is no deal"), not `owed: 0` ("the deal says nothing yet").
 */

export type ProfitShareSaleInput = {
  quantity: number
  unit_price: number
  currency_code: string
}

export type ProfitShareSettlementInput = {
  amount: number
  currency_code: string
}

export type ProfitShareStatus = "none" | "no_sales" | "open" | "settled" | "overpaid"

export type ProfitShareSummary = {
  percent: number | null
  currency_code: string
  run_quantity: number | null
  sold_quantity: number
  unsold_quantity: number | null
  gross_sales: number
  owed: number | null
  paid: number
  balance: number | null
  status: ProfitShareStatus
  /** Mixed currencies across rows — the sums are refused rather than mixed. */
  currency_mismatch: boolean
  working: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeProfitShare(input: {
  percent: number | null | undefined
  run_quantity?: number | null
  sales: ProfitShareSaleInput[]
  settlements: ProfitShareSettlementInput[]
  default_currency?: string
}): ProfitShareSummary {
  const percent =
    typeof input.percent === "number" && Number.isFinite(input.percent)
      ? input.percent
      : null
  const currency = (
    input.sales[0]?.currency_code ??
    input.settlements[0]?.currency_code ??
    input.default_currency ??
    "inr"
  ).toLowerCase()

  const currency_mismatch = [...input.sales, ...input.settlements].some(
    (r) => (r.currency_code || "").toLowerCase() !== currency
  )

  const sold_quantity = input.sales.reduce((s, r) => s + Number(r.quantity), 0)
  const gross_sales = round2(
    input.sales.reduce((s, r) => s + Number(r.quantity) * Number(r.unit_price), 0)
  )
  const paid = round2(
    input.settlements.reduce((s, r) => s + Number(r.amount), 0)
  )
  const run_quantity =
    typeof input.run_quantity === "number" ? input.run_quantity : null
  const unsold_quantity =
    run_quantity === null ? null : Math.max(0, run_quantity - sold_quantity)

  const working: string[] = input.sales.map(
    (r) =>
      `${r.quantity} × ${Number(r.unit_price).toFixed(2)} = ${round2(
        Number(r.quantity) * Number(r.unit_price)
      ).toFixed(2)}`
  )

  if (percent === null) {
    return {
      percent,
      currency_code: currency,
      run_quantity,
      sold_quantity,
      unsold_quantity,
      gross_sales,
      owed: null,
      paid,
      balance: null,
      status: "none",
      currency_mismatch,
      working,
    }
  }

  const owed = round2((gross_sales * percent) / 100)
  const balance = round2(owed - paid)
  working.push(`gross ${gross_sales.toFixed(2)} × ${percent}% = ${owed.toFixed(2)} owed`)
  if (paid) working.push(`− ${paid.toFixed(2)} paid = ${balance.toFixed(2)} balance`)

  const status: ProfitShareStatus =
    input.sales.length === 0
      ? "no_sales"
      : balance > 0
        ? "open"
        : balance === 0
          ? "settled"
          : "overpaid"

  return {
    percent,
    currency_code: currency,
    run_quantity,
    sold_quantity,
    unsold_quantity,
    gross_sales,
    owed,
    paid,
    balance,
    status,
    currency_mismatch,
    working,
  }
}
