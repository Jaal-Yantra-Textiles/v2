/**
 * How a newly proposed charge combines with what is already staged (#1752).
 *
 * ## The defect this replaces
 *
 * Staging APPENDED: `proposed_charges = [...current, ...incoming]`. The partner
 * UI posts a tax charge on every submit, and approval promotes EVERY proposed
 * charge into a real `inventory_order_charge` — which is what raises the
 * payable ceiling.
 *
 * 🔴 So a partner who proposed 18% tax, noticed a typo in a quantity and
 * submitted again left TWO tax charges of ₹12,481.20 staged against one order,
 * and nothing on their screen showed it. Lines were already idempotent (they
 * replace); charges were the odd one out.
 *
 * ## The rule
 *
 * An incoming charge SUPERSEDES the staged charges of the same `type`. Charges
 * of other types are untouched — the partner surface only proposes `tax`, but
 * an admin path adding `shipping` later must not have it silently dropped by a
 * partner restating their tax.
 *
 * An incoming amount of `0` WITHDRAWS that type. Without it there is no way to
 * take back a proposed tax: setting the percent to 0 sent nothing, so the
 * partner's screen showed no tax while the staged change still carried one.
 *
 * Pure, because it decides money and a container should not be needed to prove
 * that re-submitting twice does not charge twice.
 */

export type ProposedChargeLike = {
  type: string
  amount: number
  note?: string | null
  [k: string]: any
}

/**
 * PURE: fold incoming charges into the staged set.
 *
 * Order is preserved for the types already present — a restated tax keeps its
 * place rather than jumping to the end of the list, so a reviewer reading two
 * versions of a proposal sees the same shape.
 */
export function mergeProposedCharges(
  current: unknown,
  incoming: ProposedChargeLike[] | null | undefined
): ProposedChargeLike[] {
  const staged: ProposedChargeLike[] = Array.isArray(current)
    ? (current.filter(Boolean) as ProposedChargeLike[])
    : []

  if (!incoming?.length) {
    return staged
  }

  // Last one wins if a single request somehow names the same type twice.
  const byType = new Map<string, ProposedChargeLike>()
  for (const c of incoming) {
    if (!c?.type) continue
    byType.set(String(c.type), c)
  }

  const out: ProposedChargeLike[] = []
  const consumed = new Set<string>()

  for (const existing of staged) {
    const replacement = byType.get(String(existing?.type))
    if (!replacement) {
      out.push(existing)
      continue
    }
    consumed.add(String(existing.type))
    // 0 means "withdraw this charge", so it is dropped rather than staged as a
    // zero — a zero-amount charge would be promoted into a real ₹0 charge row.
    if (Number(replacement.amount) > 0) {
      out.push(replacement)
    }
  }

  // Types that were not already staged are appended, in the order the request
  // first names them — but taking the DEDUPED entry, so a request naming `tax`
  // twice stages the later one rather than the earlier.
  const appended = new Set<string>()
  for (const c of incoming) {
    const type = String(c?.type ?? "")
    if (!type || consumed.has(type) || appended.has(type)) continue
    appended.add(type)
    const winner = byType.get(type)!
    if (Number(winner.amount) > 0) {
      out.push(winner)
    }
  }

  return out
}
