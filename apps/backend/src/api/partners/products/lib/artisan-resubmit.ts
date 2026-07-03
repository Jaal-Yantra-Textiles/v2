// #859 S2 (#861) — pure decision for an artisan re-submitting a rejected
// product for review. Kept free of container/query so it's unit-testable; the
// route gathers the facts (ownership + current status) and delegates here.

export type ResubmitFacts = {
  /** True when the requesting partner owns this product (partner-product link). */
  ownedByPartner: boolean
  /** Native ProductStatus of the product. */
  currentStatus?: string | null
}

export type ResubmitDecision =
  | { ok: true; nextStatus: "proposed"; event: "partner_product.proposed" }
  | { ok: false; code: "not_owner" | "invalid_status"; reason: string }

/**
 * Decide whether an artisan may re-submit their product.
 *
 * - Only the owning partner can re-submit (ownership enforced by the route).
 * - Allowed only from `rejected` → `proposed` (a fresh review round). A product
 *   that is still `proposed` (already under review) or `published` is a no-op
 *   the caller should reject with a clear message.
 */
export function decideResubmit(facts: ResubmitFacts): ResubmitDecision {
  if (!facts.ownedByPartner) {
    return {
      ok: false,
      code: "not_owner",
      reason: "You do not own this product",
    }
  }

  if (facts.currentStatus === "rejected") {
    return { ok: true, nextStatus: "proposed", event: "partner_product.proposed" }
  }

  return {
    ok: false,
    code: "invalid_status",
    reason: `Only a rejected product can be re-submitted (current status '${facts.currentStatus}')`,
  }
}
