/**
 * Pure helpers for the company cap table's Ownership donut.
 *
 * One holder can own several stakes — e.g. founding shares plus shares
 * allotted later on a loan conversion. Drawing one slice per stake split that
 * holder into two slices ("A 10%, A 80%" instead of "A 90%"). Ownership is per
 * HOLDER, by SHARES held.
 */

export type OwnershipStakeLike = {
  investor_id?: string | null
  investor?: { id?: string | null; name?: string | null } | null
  number_of_shares?: number | null
  total_invested?: number | null
  status?: string | null
}

export type HolderOwnership = {
  key: string
  label: string
  /** Shares held — falls back to amount invested when a stake has no share count. */
  value: number
}

/** Only fully paid stakes are absorbed into the capital table. */
export const ABSORBED_STAKE_STATUSES = new Set(["fully_paid"])

const stakeWeight = (s: OwnershipStakeLike) =>
  Number(s.number_of_shares ?? 0) || Number(s.total_invested ?? 0) || 0

/** Paid-up stakes summed per holder, largest first. */
export function ownershipByHolder(stakes: OwnershipStakeLike[]): HolderOwnership[] {
  const byHolder = new Map<string, HolderOwnership>()
  for (const s of stakes) {
    if (!ABSORBED_STAKE_STATUSES.has(String(s.status ?? ""))) continue
    const key = s.investor_id ?? s.investor?.id ?? s.investor?.name ?? "unknown"
    const row = byHolder.get(key) ?? { key, label: s.investor?.name ?? "Investor", value: 0 }
    row.value += stakeWeight(s)
    byHolder.set(key, row)
  }
  return [...byHolder.values()]
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
}
