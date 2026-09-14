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
