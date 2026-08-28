/**
 * What a consumption log is ANCHORED to, and what scopes a commit.
 *
 * PURE: no container, no DB. Both rules decide whether real material is
 * recorded and whether stock is deducted, and both were previously implicit —
 * one in a `not null` column, the other in a caller's good manners.
 */

export type ConsumptionAnchorInput = {
  design_id?: string | null
  product_id?: string | null
}

/**
 * A log must name a design or a product.
 *
 * `design_id text not null` used to enforce this for free, and stopped being
 * right when product-only runs shipped (#1112). Making it nullable without
 * putting this in its place would allow a row anchored to NOTHING — one that
 * can never be costed, committed or reconciled, and that no other check would
 * refuse.
 */
export const anchorRefusalMessage = (
  input: ConsumptionAnchorInput
): string | null => {
  if (input.design_id || input.product_id) return null

  return (
    "A consumption log must name a design or a product. Neither was given, " +
    "and a log anchored to nothing can never be costed, committed or reconciled."
  )
}

export type CommitScopeInput = {
  design_id?: string | null
  production_run_id?: string | null
  product_id?: string | null
}

export type CommitScope =
  | { ok: true; filters: Record<string, any>; scope: string }
  | { ok: false; error: string }

/**
 * The filter that scopes a commit — exactly one anchor, and never none.
 *
 * 🔴 The refusal is the point. `{ design_id: undefined }` is not "no rows", it
 * is NO FILTER (the shape behind #1397), so a commit called with nothing set
 * would sweep up every uncommitted log on the platform and mark it committed —
 * which is what `apply-to-inventory` then reads before deducting stock.
 *
 * Precedence design > run > product is deliberate: the design-scoped route is
 * the pre-existing caller and must keep behaving exactly as it did.
 */
export const resolveCommitScope = (input: CommitScopeInput): CommitScope => {
  if (input.design_id) {
    return {
      ok: true,
      scope: `design ${input.design_id}`,
      filters: { design_id: input.design_id },
    }
  }

  if (input.production_run_id) {
    return {
      ok: true,
      scope: `production run ${input.production_run_id}`,
      filters: { production_run_id: input.production_run_id },
    }
  }

  if (input.product_id) {
    return {
      ok: true,
      scope: `product ${input.product_id}`,
      filters: { product_id: input.product_id },
    }
  }

  return {
    ok: false,
    error:
      "Committing consumption requires a design_id, production_run_id or product_id " +
      "to scope it. Without one this would commit every uncommitted log.",
  }
}
