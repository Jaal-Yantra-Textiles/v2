/**
 * May THIS payment settle THAT payout? (#1712)
 *
 * ## Why this exists
 *
 * `POST /admin/payments/:id/settles` validated that both ids EXIST and that the
 * payout was not Rejected — and nothing else. Neither end was checked against
 * the other, so a payment belonging to partner A could be declared to discharge
 * partner B's payout. The route is the one place a human turns "money moved"
 * into "this payout is paid", and it decides `paid` on the partner ledger, so an
 * id typed one character wrong silently pays the wrong person.
 *
 * That is the #778 shape — a request naming two ids that checks one — and it
 * matters more here than for a read, because a bulk reconciliation pass makes
 * exactly this mistake easy and near-invisible afterwards.
 *
 * ## Why it is PERMISSIVE when the payment has no owner
 *
 * 🔑 A payment can legitimately belong to nobody the graph can name. The
 * historical `internal_payments` rows carry no partner link, no order link and
 * sometimes no payment method — they predate every link this codebase has. On
 * production, 6 of 35 payments are reachable ONLY through `paid_to`, and older
 * rows not even that.
 *
 * Refusing those would block the reconciliation work this guard exists to make
 * safe. So the rule is: refuse only when the payment DEMONSTRABLY belongs to
 * someone else. An unattributable payment is still allowed, because we cannot
 * prove a mismatch and the operator is asserting the fact deliberately.
 *
 * ⚠️ That is a real hole, and a narrow one: it lets an unlinked payment settle
 * any partner's payout. Closing it needs every payment to carry an owner, which
 * is a backfill, not a guard.
 */
export type SamePartnerDecision = {
  allowed: boolean
  /** Every partner the payment can be traced to, deduped. */
  owners: string[]
}

/**
 * PURE, so the rule can be tested without a graph behind it — the resolution
 * below is best-effort and its failure modes are not the interesting part.
 */
export const decideSamePartner = (
  owners: Array<string | null | undefined>,
  submissionPartnerId: string | null | undefined
): SamePartnerDecision => {
  const set = [
    ...new Set(
      (owners || [])
        .filter((o) => o !== null && o !== undefined && String(o).trim() !== "")
        .map((o) => String(o))
    ),
  ]

  /**
   * ⚠️ A payout with no partner is not a thing this route can adjudicate, and
   * `undefined !== "x"` would refuse every such call. Allow and let the
   * existing checks stand.
   */
  if (!submissionPartnerId || String(submissionPartnerId).trim() === "") {
    return { allowed: true, owners: set }
  }

  if (set.length === 0) return { allowed: true, owners: set }

  return { allowed: set.includes(String(submissionPartnerId)), owners: set }
}

/**
 * Every partner a payment can be traced to, across the homes a payment can
 * live in. Best-effort per home, for the same reason the ledger is: losing one
 * home understates ownership, and an understated owner set is PERMISSIVE here
 * (see `decideSamePartner`) rather than a false refusal.
 *
 * 🔴 The homes are the ones #1710 established, plus `paid_to`:
 *   1. the partner link       — payments recorded against the partner directly
 *   2. the inventory-order link → that order's partner (`submit-payment` writes
 *      ONLY this one, so Parmar's two INR 10,000 rows live here and nowhere else)
 *   3. the paid_to payment METHOD → its partner — on production this is the
 *      ONLY home for 6 of 35 payments, and the ledger cannot see it at all.
 *
 * ⚠️ Field names are the link entry-point convention `<module_model>_id`, which
 * is not type-checked. A wrong name yields no rows, no error, and a guard that
 * never fires — so each home is asserted in the unit tests by shape, and the
 * route is probed cross-partner after deploy.
 */
export const resolvePaymentOwners = async (
  query: any,
  links: {
    partnerPayments: any
    orderPayments: any
    partnerOrders: any
    partnerMethods: any
  },
  paymentId: string,
  paidToId?: string | null
): Promise<string[]> => {
  const owners: string[] = []

  // ── 1. the PARTNER link ────────────────────────────────────────────────
  try {
    const { data } = await query.graph({
      entity: links.partnerPayments.entryPoint,
      fields: ["partner_id"],
      filters: { internal_payments_id: paymentId },
    })
    for (const row of data || []) if (row?.partner_id) owners.push(String(row.partner_id))
  } catch {
    // best-effort; see above
  }

  // ── 2. the INVENTORY ORDER link, then that order's partner ─────────────
  try {
    const { data: orderRows } = await query.graph({
      entity: links.orderPayments.entryPoint,
      fields: ["inventory_orders_id"],
      filters: { internal_payments_id: paymentId },
    })
    const orderIds = [
      ...new Set(
        (orderRows || [])
          .map((r: any) => r?.inventory_orders_id)
          .filter(Boolean)
          .map(String)
      ),
    ]
    if (orderIds.length) {
      const { data: partnerRows } = await query.graph({
        entity: links.partnerOrders.entryPoint,
        fields: ["partner_id"],
        filters: { inventory_orders_id: orderIds },
      })
      for (const row of partnerRows || [])
        if (row?.partner_id) owners.push(String(row.partner_id))
    }
  } catch {
    // best-effort; see above
  }

  // ── 3. the paid_to METHOD link ─────────────────────────────────────────
  if (paidToId) {
    try {
      const { data } = await query.graph({
        entity: links.partnerMethods.entryPoint,
        fields: ["partner_id"],
        filters: { internal_payment_details_id: String(paidToId) },
      })
      for (const row of data || [])
        if (row?.partner_id) owners.push(String(row.partner_id))
    } catch {
      // best-effort; see above
    }
  }

  return [...new Set(owners)]
}
