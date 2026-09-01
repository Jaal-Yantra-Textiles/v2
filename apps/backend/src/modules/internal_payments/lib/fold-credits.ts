/**
 * What a partner's credits add up to (#1712).
 *
 * PURE, and shared by the admin route and the partner route deliberately. Both
 * answer "how much does this partner already hold", and the moment each folds
 * it for itself the two surfaces start disagreeing about a money figure — which
 * is exactly how `foldPartnerBilling` ended up with a private copy in
 * `partner-ui` and the run-line pricer ended up with two homes.
 */
export type CreditLike = {
  id?: string
  amount?: number | string | null
  status?: string | null
  currency_code?: string | null
}

export type FoldedCredits = {
  count: number
  /**
   * 🔑 Only `Open` credits. An `Applied` credit has already reduced a payout,
   * and counting it again would offer the same money twice — the same mistake
   * the per-payout settlement clamp exists to prevent.
   */
  open_total: number
  currency: string | null
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export const foldPartnerCredits = (
  credits: CreditLike[] | null | undefined
): FoldedCredits => {
  const rows = (credits || []).filter(Boolean)
  const open = rows.filter((c) => String(c?.status ?? "") === "Open")

  const openTotal = open.reduce((acc, c) => acc + num(c.amount), 0)

  return {
    count: rows.length,
    open_total: Math.round(openTotal * 100) / 100,
    /**
     * ⚠️ Taken from an OPEN credit first. A partner whose only remaining
     * credits are `Applied` has no live balance, and reporting that row's
     * currency beside `open_total: 0` invites reading the zero as a figure in
     * that currency rather than as "nothing held".
     */
    currency: open[0]?.currency_code ?? rows[0]?.currency_code ?? null,
  }
}
