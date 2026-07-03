// #859 S2 (#861) — pure decision for the admin approve/reject of an artisan's
// proposed product. Kept free of container/query so it's unit-testable; the
// route gathers the facts (ownership + current status) and delegates here.

export type ApprovalAction = "approve" | "reject"

export type ApprovalFacts = {
  /** True when a partner-product link exists (product is artisan-owned). */
  hasOwnerLink: boolean
  /** Native ProductStatus of the product. */
  currentStatus?: string | null
}

export type ApprovalDecision =
  | { ok: true; nextStatus: "published" | "rejected"; event: string }
  | { ok: false; code: "not_artisan_owned" | "invalid_status"; reason: string }

/**
 * Decide the status transition for an admin approve/reject of an artisan
 * product.
 *
 * - Only artisan-owned products (with a partner-product link) can be actioned.
 * - approve: allowed from `proposed` or `rejected` (re-approve) → `published`.
 * - reject:  allowed from `proposed` → `rejected`.
 * - Already-`published` products are not re-actionable (idempotent guard).
 */
export function decideApprovalTransition(
  action: ApprovalAction,
  facts: ApprovalFacts
): ApprovalDecision {
  if (!facts.hasOwnerLink) {
    return {
      ok: false,
      code: "not_artisan_owned",
      reason: "Product is not an artisan-proposed product",
    }
  }

  const status = facts.currentStatus ?? null

  if (action === "approve") {
    if (status === "proposed" || status === "rejected") {
      return { ok: true, nextStatus: "published", event: "partner_product.approved" }
    }
    return {
      ok: false,
      code: "invalid_status",
      reason: `Cannot approve a product in status '${status}' (expected 'proposed' or 'rejected')`,
    }
  }

  // reject
  if (status === "proposed") {
    return { ok: true, nextStatus: "rejected", event: "partner_product.rejected" }
  }
  return {
    ok: false,
    code: "invalid_status",
    reason: `Cannot reject a product in status '${status}' (expected 'proposed')`,
  }
}
