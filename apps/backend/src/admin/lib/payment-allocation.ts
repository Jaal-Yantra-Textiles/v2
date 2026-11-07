/**
 * Splitting one payment across a partner's open payouts (#2523) — the
 * arithmetic behind the "Pay bills with this payment" drawer, kept pure so it
 * is tested without a browser.
 */

export type OpenPayout = {
  submission_id: string
  /** What the payout still claims: amount - settled - credited. */
  remaining: number
  submitted_at?: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** What a payout still claims, from a ledger payout entry. */
export const payoutRemaining = (entry: {
  amount?: number | null
  settled_amount?: number | null
  credited_amount?: number | null
}): number =>
  Math.max(
    0,
    round2(
      Number(entry.amount ?? 0) -
        Number(entry.settled_amount ?? 0) -
        Number(entry.credited_amount ?? 0)
    )
  )

/**
 * The suggested split: oldest payout first, each taking what it still claims,
 * until the payment runs out — the same rule the ledger uses when nobody names
 * a share, so the drawer opens on what would happen anyway.
 */
export const suggestShares = (
  paymentAmount: number,
  payouts: OpenPayout[]
): Record<string, number> => {
  const ordered = [...payouts].sort((a, b) => {
    const at = a.submitted_at || ""
    const bt = b.submitted_at || ""
    return at === bt
      ? a.submission_id.localeCompare(b.submission_id)
      : at.localeCompare(bt)
  })
  let left = round2(paymentAmount)
  const shares: Record<string, number> = {}
  for (const p of ordered) {
    const take = round2(Math.max(0, Math.min(left, p.remaining)))
    shares[p.submission_id] = take
    left = round2(left - take)
  }
  return shares
}

export type SharesVerdict = {
  total: number
  left: number
  problems: string[]
}

/** What the typed shares add up to, and what is wrong with them, if anything. */
export const checkShares = (
  paymentAmount: number,
  shares: Record<string, number>,
  payouts: OpenPayout[]
): SharesVerdict => {
  const problems: string[] = []
  let total = 0
  for (const p of payouts) {
    const share = Number(shares[p.submission_id] ?? 0)
    if (!Number.isFinite(share) || share < 0) {
      problems.push(`${p.submission_id}: a share must be zero or more`)
      continue
    }
    if (round2(share) > round2(p.remaining)) {
      problems.push(
        `${p.submission_id}: ${share} is more than the ${p.remaining} it still claims`
      )
    }
    total = round2(total + share)
  }
  const left = round2(paymentAmount - total)
  if (left < 0) {
    problems.push(`the shares add up to ${total}, more than the payment's ${paymentAmount}`)
  }
  return { total, left, problems }
}
