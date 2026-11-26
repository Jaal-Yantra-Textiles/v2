import { splitDeposit } from "../../../../../../modules/payment_schedule/lib/split"

const round2 = (n: number) => Math.round(n * 100) / 100

export type PreviewDeposit = {
  deposit_pct: number | null
  deposit_amount: number
  balance_amount: number | null
  balance_trigger: "manual" | "dispatch"
  note: string
}

/**
 * PURE (#2645). The split a deposit WOULD make on the preview's pre-tax total,
 * or null when no deposit was asked for or the total is partial (a split of a
 * partial total is a wrong number). Create re-checks it on the real, taxed
 * total; nothing here is saved.
 */
export const previewDeposit = (input: {
  total: number
  complete: boolean
  deposit_pct?: number
  deposit_amount?: number
  balance_trigger?: "manual" | "dispatch"
}): PreviewDeposit | null => {
  const hasPct = typeof input.deposit_pct === "number"
  const hasAmount = typeof input.deposit_amount === "number"
  if ((!hasPct && !hasAmount) || !input.complete || !(input.total > 0)) return null
  const trigger = input.balance_trigger ?? "manual"
  const note =
    "Before GST and shipping. A percentage follows the taxed total at checkout; a fixed amount does not."
  if (hasAmount) {
    const amount = Number(input.deposit_amount)
    if (!(amount < input.total)) {
      return {
        deposit_pct: null,
        deposit_amount: amount,
        balance_amount: null,
        balance_trigger: trigger,
        note: `A fixed deposit of ${amount} is not below this total of ${input.total}; create would refuse it.`,
      }
    }
    return {
      deposit_pct: null,
      deposit_amount: amount,
      balance_amount: round2(input.total - amount),
      balance_trigger: trigger,
      note,
    }
  }
  const split = splitDeposit(input.total, input.deposit_pct)
  return {
    deposit_pct: split.deposit_pct,
    deposit_amount: split.deposit_amount,
    balance_amount: split.balance_amount,
    balance_trigger: trigger,
    note,
  }
}
