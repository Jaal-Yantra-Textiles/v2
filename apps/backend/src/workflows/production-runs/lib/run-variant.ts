/**
 * Which variant a run's finished goods belong to — one implementation.
 *
 * 🔴 This logic existed twice, verbatim: `stockFinishedGoodsStep` (banking
 * output at completion) and `receive-goods-transfer` (crediting output at the
 * far end of a hop) each did "the run's own `variant_id` wins, otherwise take
 * `design_product_variant[0]`", then resolved that variant to an inventory
 * item. Two copies of the question "what did this run actually make" is how the
 * two ends of a goods movement come to disagree about the product.
 *
 * The `[0]` in both was safe only by accident: `design-variant-link` was
 * `isList: false` on the variant side, so a second variant per design THREW at
 * write time and the table could never hold an ambiguous row. #2057 makes a
 * design able to hold many variants, which turns that accident into a lottery —
 * every customer's goods banked onto whichever variant came back first. So the
 * pick refuses instead. #1872, #1874
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type RunVariantFailure =
  | "no_variant_and_no_design"
  | "design_has_no_variant"
  | "ambiguous_design_variants"
  | "variant_has_no_inventory_item"

export type ResolveRunVariantResult = {
  variant_id?: string
  inventory_item_id?: string
  /** "run" when the run named its own variant, "design_link" for the fallback. */
  source?: "run" | "design_link"
  reason?: RunVariantFailure
  /** Every variant the design links to — populated when the answer is ambiguous. */
  candidate_variant_ids?: string[]
}

/**
 * PURE: the one variant a design's output belongs to.
 *
 * Exactly one → that one. None → null. **More than one → null**, deliberately.
 * A design with two variants (say Small and Medium) cannot say which one a run
 * produced; `[0]` answers that with whichever row the database returned first,
 * and the goods are then banked as the wrong size. The run's own `variant_id`
 * is the only thing that can answer it, which is why it is preferred and why
 * its absence is a refusal rather than a guess.
 */
export function pickDesignVariant(
  rows: Array<{ product_variant_id?: string | null } | null> | null | undefined
): { id: string } | null {
  const ids = (rows ?? [])
    .map((r) => r?.product_variant_id)
    .filter((id): id is string => !!id)
  const unique = Array.from(new Set(ids))
  return unique.length === 1 ? { id: unique[0] } : null
}

/**
 * Resolve the variant AND its inventory item for a run's output.
 *
 * The run's own `variant_id` wins; the design link is the fallback for runs
 * written before that column was populated. Returns a `reason` rather than a
 * bare `undefined` so a caller can tell "this design has no product yet" (a
 * legitimate no-op) from "this design has two variants and nobody said which"
 * (a refusal).
 */
export async function resolveRunVariant(
  container: any,
  run: { variant_id?: string | null; design_id?: string | null }
): Promise<ResolveRunVariantResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  let variantId: string | undefined = run.variant_id ?? undefined
  let source: "run" | "design_link" = "run"

  if (!variantId) {
    if (!run.design_id) return { reason: "no_variant_and_no_design" }

    const { data: designVariants } = await query.graph({
      entity: "design_product_variant",
      filters: { design_id: run.design_id },
      fields: ["product_variant_id"],
    })

    const rows = (designVariants ?? []) as Array<{ product_variant_id?: string }>
    const pick = pickDesignVariant(rows)

    if (!pick) {
      const ids = rows.map((r) => r?.product_variant_id).filter(Boolean) as string[]
      if (ids.length > 1) {
        return {
          reason: "ambiguous_design_variants",
          candidate_variant_ids: Array.from(new Set(ids)),
        }
      }
      return { reason: "design_has_no_variant" }
    }

    variantId = pick.id
    source = "design_link"
  }

  const { data: variantInventory } = await query.graph({
    entity: "product_variant_inventory_item",
    filters: { variant_id: variantId },
    fields: ["inventory_item_id"],
  })

  const inventoryItemId = variantInventory?.[0]?.inventory_item_id
  if (!inventoryItemId) {
    return { variant_id: variantId, source, reason: "variant_has_no_inventory_item" }
  }

  return { variant_id: variantId, inventory_item_id: inventoryItemId, source }
}

/* -------------------------------------------------------------------------
 * Approval: which product AND variant a design's approved output is
 * ---------------------------------------------------------------------- */

export type ApprovalTargetFailure =
  | "runs_disagree"
  | "design_has_no_variant"
  | "ambiguous_design_variants"
  | "ambiguous_design_products"

export type DesignApprovalTarget = {
  product_id: string | null
  variant_id: string | null
  /** "run" when the runs named it, "design_link" for the link-table fallback. */
  source?: "run" | "design_link"
  reason?: ApprovalTargetFailure
  candidate_variant_ids?: string[]
  candidate_product_ids?: string[]
}

/**
 * PURE: the one variant a batch of runs agrees it produced.
 *
 * Exactly one distinct non-null `variant_id` → that one. None → undefined,
 * meaning the runs say nothing and the design link must answer. **More than
 * one → null**: two runs of the same design that made different variants
 * cannot be collapsed into a single approval target, and picking either one
 * stamps the wrong garment on the other's run.
 */
export function pickRunsVariant(
  runs: Array<{ variant_id?: string | null } | null> | null | undefined
): { id: string } | null | undefined {
  const ids = Array.from(
    new Set(
      (runs ?? [])
        .map((r) => r?.variant_id)
        .filter((id): id is string => !!id)
    )
  )
  if (!ids.length) return undefined
  return ids.length === 1 ? { id: ids[0] } : null
}

/**
 * What an approval should record on a design that ALREADY has a product.
 *
 * 🔴 This replaces `design.products[0].variants[0]`.
 *
 * A product is many-to-many with designs (`product-design-link`) and carries
 * one variant per design that has been minted onto it (`create-product-from-
 * design` appends). So `variants[0]` is *the product's* first variant, which on
 * a shared product is ANOTHER DESIGN'S — a different garment, at a different
 * price, stamped onto this run as `approved_variant_id` and later fulfilled
 * against. It was rare only because the append path was silently failing; #2070
 * repaired it, so shared products are now the expected shape.
 *
 * The order of authority is the platform's everywhere else (see
 * `resolveRunVariant`): the runs' own `variant_id` wins, the design↔variant
 * link answers when they are silent, and an ambiguous answer is REFUSED rather
 * than guessed. A refusal leaves `approved_variant_id` null — null is a state
 * an operator can see and repair; a confident wrong id is not.
 *
 * The product follows the variant that was chosen, not row 0 of the product
 * link: `linkedProducts` usually resolves it with no extra query, because the
 * design read already fetched each product's variant ids.
 */
export async function resolveDesignApprovalTarget(
  container: any,
  input: {
    designId: string
    runs: Array<{ variant_id?: string | null }>
    linkedProducts: Array<{ id?: string | null; variants?: Array<{ id?: string | null }> | null }>
  }
): Promise<DesignApprovalTarget> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const productIds = Array.from(
    new Set(
      (input.linkedProducts ?? [])
        .map((p) => p?.id)
        .filter((id): id is string => !!id)
    )
  )

  /** The product, when only one thing can be meant by "the design's product". */
  const soleProductId = productIds.length === 1 ? productIds[0] : null

  const refuse = (
    reason: ApprovalTargetFailure,
    extra: Partial<DesignApprovalTarget> = {}
  ): DesignApprovalTarget => ({
    product_id: soleProductId,
    variant_id: null,
    reason,
    ...extra,
  })

  let variantId: string | undefined
  let source: "run" | "design_link" = "run"

  const fromRuns = pickRunsVariant(input.runs)
  if (fromRuns === null) {
    return refuse("runs_disagree", {
      candidate_variant_ids: Array.from(
        new Set(
          input.runs.map((r) => r?.variant_id).filter((id): id is string => !!id)
        )
      ),
    })
  }
  variantId = fromRuns?.id

  if (!variantId) {
    const { data: links = [] } = await query.graph({
      entity: "design_product_variant",
      filters: { design_id: input.designId },
      fields: ["product_variant_id"],
    })

    const rows = (links ?? []) as Array<{ product_variant_id?: string }>
    const pick = pickDesignVariant(rows)
    if (!pick) {
      const ids = Array.from(
        new Set(
          rows.map((r) => r?.product_variant_id).filter((id): id is string => !!id)
        )
      )
      return ids.length > 1
        ? refuse("ambiguous_design_variants", { candidate_variant_ids: ids })
        : refuse("design_has_no_variant")
    }
    variantId = pick.id
    source = "design_link"
  }

  /**
   * The product the chosen variant actually belongs to. Answered from the
   * design read where it can be — the fields already include each linked
   * product's variant ids — and asked for only when the variant sits on a
   * product this design is not linked to, which is worth knowing rather than
   * papering over with row 0.
   */
  const owning = (input.linkedProducts ?? []).find((p) =>
    (p?.variants ?? []).some((v) => v?.id === variantId)
  )
  if (owning?.id) {
    return { product_id: owning.id, variant_id: variantId, source }
  }

  const { data: variants = [] } = await query.graph({
    entity: "product_variant",
    filters: { id: variantId },
    fields: ["id", "product_id"],
  })
  const productId = (variants ?? [])[0]?.product_id ?? null

  if (productId) return { product_id: productId, variant_id: variantId, source }

  /**
   * A variant we cannot place on a product. The variant is still the answer —
   * it is what the run named — but the product is only recorded when one
   * linked product can be meant, never by taking row 0 of several.
   */
  return productIds.length > 1
    ? {
        product_id: null,
        variant_id: variantId,
        source,
        reason: "ambiguous_design_products",
        candidate_product_ids: productIds,
      }
    : { product_id: soleProductId, variant_id: variantId, source }
}

/**
 * The refusal, in words an operator can act on.
 *
 * Every one of these ends in what to DO, because the approval still succeeded:
 * the product is listed and the runs are decided, and only the variant binding
 * is missing. A message that merely says "ambiguous" leaves the run in a state
 * nobody knows how to clear.
 */
export function describeApprovalTarget(
  designId: string,
  target: DesignApprovalTarget
): string {
  const variants = target.candidate_variant_ids?.join(", ") ?? ""
  switch (target.reason) {
    case "runs_disagree":
      return (
        `design ${designId} was approved without a variant: its runs name ` +
        `different variants (${variants}). Approve them separately, or per-run ` +
        `stamping has to answer this.`
      )
    case "ambiguous_design_variants":
      return (
        `design ${designId} was approved without a variant: it has ` +
        `${target.candidate_variant_ids?.length} variants (${variants}) and no run ` +
        `says which was produced. Set the runs' variant_id, then approve again.`
      )
    case "design_has_no_variant":
      return (
        `design ${designId} was approved without a variant: it links to a ` +
        `product but to no variant of it. Nothing can be fulfilled against this ` +
        `approval until the design is minted onto a variant.`
      )
    case "ambiguous_design_products":
      return (
        `design ${designId} was approved without a product: its variant sits on ` +
        `none of the ${target.candidate_product_ids?.length} products it links to ` +
        `(${target.candidate_product_ids?.join(", ")}).`
      )
    default:
      return `design ${designId}: approval target unresolved.`
  }
}
