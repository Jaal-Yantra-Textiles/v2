/**
 * Re-point a design at an EXISTING product — the plan, decided without I/O.
 *
 * #2477 part 2. Approval reuses whatever product a design is linked to
 * (`approve-run-output`'s idempotency rule), so a design minted onto the wrong
 * product keeps being approved onto it — "Butterfly Shirt with Lace" had its
 * own draft while its garments are sold as the lace variants of Butterfly
 * Shirt. Until this existed the only repair was to edit link rows by hand.
 *
 * Three things point from a design at a product, and all three have to move
 * together or the readers disagree about where the goods are:
 *   1. the design ↔ product link (`product-design-link`) — what approval reuses;
 *   2. the design ↔ variant links (`design-variant-link`) — what stocking and
 *      order binding read when a run names no variant (`run-variant.ts`);
 *   3. the design's RUNS — `product_id` / `variant_id`, and the
 *      `approved_*` stamps of runs already decided.
 *
 * 🔴 A variant is made from exactly ONE design (`design-variant-link` is
 * `isList: false` on the design side). Linking a variant that another design
 * already backs takes it away from that design, so it is refused unless the
 * caller says so — the merged Butterfly lace variants are the case, and the
 * plain Butterfly design must not lose its own sizes by accident.
 */

export type RelinkInput = {
  designId: string
  /** The product to point at, with its variant ids; null when it does not exist. */
  target: { id: string; variant_ids: string[] } | null
  /** Products the design links to today. */
  linkedProductIds: string[]
  /** The design's variant links today, each with the product the variant sits on. */
  designVariants: Array<{ variant_id: string; product_id: string | null }>
  /**
   * Given → REPLACES the design's variant links. Omitted → links to variants
   * on the target product are kept and the rest are dropped.
   */
  requestedVariantIds?: string[] | null
  /** variant id → the design it is linked to today (only for requested ids). */
  variantDesigns: Map<string, string>
  moveVariantsFromOtherDesigns?: boolean
  runs: Array<{
    id: string
    product_id?: string | null
    variant_id?: string | null
    approved_product_id?: string | null
    approved_variant_id?: string | null
  }>
}

export type RunRepoint = {
  run_id: string
  /** Only the fields that change. */
  update: {
    product_id?: string
    variant_id?: null
    approved_product_id?: string
    approved_variant_id?: null
  }
}

export type RelinkPlan = {
  design_id: string
  product_id: string
  link_product: boolean
  unlink_product_ids: string[]
  link_variant_ids: string[]
  unlink_variant_ids: string[]
  /** Variants taken from another design (only with the flag). */
  moved_variants: Array<{ variant_id: string; from_design_id: string }>
  runs: RunRepoint[]
  noop: boolean
}

export type RelinkRefusal = {
  error:
    | "product_not_found"
    | "variant_not_on_product"
    | "variant_belongs_to_another_design"
  message: string
  variant_ids?: string[]
}

const uniq = (ids: Array<string | null | undefined>): string[] =>
  Array.from(new Set(ids.filter((id): id is string => !!id)))

export function planDesignProductRelink(
  input: RelinkInput
): RelinkPlan | RelinkRefusal {
  const { designId, target } = input
  if (!target) {
    return {
      error: "product_not_found",
      message: `The product to link design ${designId} to does not exist.`,
    }
  }

  const onTarget = new Set(target.variant_ids)
  const current = new Map(
    input.designVariants.map((v) => [v.variant_id, v.product_id ?? null])
  )

  let wanted: string[]
  if (input.requestedVariantIds) {
    wanted = uniq(input.requestedVariantIds)
    const foreign = wanted.filter((id) => !onTarget.has(id))
    if (foreign.length) {
      return {
        error: "variant_not_on_product",
        message: `Variant(s) ${foreign.join(", ")} are not on product ${target.id}.`,
        variant_ids: foreign,
      }
    }
  } else {
    // Keep what already sits on the target; everything else goes.
    wanted = Array.from(current.keys()).filter((id) => onTarget.has(id))
  }

  const moved = wanted
    .map((variant_id) => ({
      variant_id,
      from_design_id: input.variantDesigns.get(variant_id),
    }))
    .filter(
      (m): m is { variant_id: string; from_design_id: string } =>
        !!m.from_design_id && m.from_design_id !== designId
    )
  if (moved.length && !input.moveVariantsFromOtherDesigns) {
    return {
      error: "variant_belongs_to_another_design",
      message:
        `Variant(s) ${moved
          .map((m) => `${m.variant_id} (design ${m.from_design_id})`)
          .join(", ")} are made from another design. A variant has one design, ` +
        `so linking it here takes it from that one. Pass ` +
        `move_variants_from_other_designs: true if that is what you mean.`,
      variant_ids: moved.map((m) => m.variant_id),
    }
  }

  const wantedSet = new Set(wanted)
  const unlinkProductIds = uniq(input.linkedProductIds).filter(
    (id) => id !== target.id
  )
  const droppedProducts = new Set(unlinkProductIds)
  const unlinkVariantIds = Array.from(current.keys()).filter(
    (id) => !wantedSet.has(id)
  )
  const droppedVariants = new Set(unlinkVariantIds)
  const linkVariantIds = wanted.filter((id) => !current.has(id))

  /**
   * A run's own `variant_id` is the FIRST authority everywhere it is read
   * (`resolveRunVariant`, `resolveRunApprovalStamp`). Leaving one that points
   * at a variant this design no longer backs would quietly outrank the new
   * links, so it is cleared — null is a state approval reports; a stale id is
   * not.
   */
  const stale = (variantId?: string | null): boolean =>
    !!variantId &&
    !wantedSet.has(variantId) &&
    (droppedVariants.has(variantId) || !onTarget.has(variantId))

  const runs: RunRepoint[] = []
  for (const run of input.runs) {
    const update: RunRepoint["update"] = {}
    if (run.product_id && droppedProducts.has(run.product_id)) {
      update.product_id = target.id
    }
    if (stale(run.variant_id)) update.variant_id = null
    if (run.approved_product_id && droppedProducts.has(run.approved_product_id)) {
      update.approved_product_id = target.id
    }
    if (stale(run.approved_variant_id)) update.approved_variant_id = null
    if (Object.keys(update).length) runs.push({ run_id: run.id, update })
  }

  const linkProduct = !input.linkedProductIds.includes(target.id)

  return {
    design_id: designId,
    product_id: target.id,
    link_product: linkProduct,
    unlink_product_ids: unlinkProductIds,
    link_variant_ids: linkVariantIds,
    unlink_variant_ids: unlinkVariantIds,
    moved_variants: moved,
    runs,
    noop:
      !linkProduct &&
      !unlinkProductIds.length &&
      !linkVariantIds.length &&
      !unlinkVariantIds.length &&
      !runs.length,
  }
}

export function isRelinkRefusal(
  r: RelinkPlan | RelinkRefusal
): r is RelinkRefusal {
  return (r as RelinkRefusal).error !== undefined
}
