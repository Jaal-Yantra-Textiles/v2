import { z } from "@medusajs/framework/zod"

/**
 * Bulk product / variant / inventory update.
 *
 * Field objects are `passthrough()` on purpose: the shared engine picks the
 * columns it accepts from an allow-list (`PRODUCT_FIELDS` / `VARIANT_FIELDS`)
 * and drops the rest, so validating the exact column set twice would mean two
 * lists to keep in step and a 400 the moment they drift.
 */

const VariantTargetSchema = z.object({
  variant_id: z.string().min(1),
  update: z.record(z.string(), z.any()).optional(),
})

const ProductTargetSchema = z.object({
  product_id: z.string().min(1),
  update: z.record(z.string(), z.any()).optional(),
  /** Omit to mean every variant of this product. */
  variants: z.array(VariantTargetSchema).optional(),
})

const SelectorSchema = z
  .object({
    product_ids: z.array(z.string().min(1)).optional(),
    collection_id: z.array(z.string().min(1)).optional(),
    category_id: z.array(z.string().min(1)).optional(),
    status: z.array(z.string().min(1)).optional(),
    all: z.boolean().optional(),
  })
  .refine(
    (s) =>
      s.all ||
      s.product_ids?.length ||
      s.collection_id?.length ||
      s.category_id?.length ||
      s.status?.length,
    {
      message:
        "selector must narrow something — pass all: true explicitly to mean the whole catalogue.",
    }
  )

const InventorySchema = z.object({
  /** Absolute on-hand quantity. Not a delta; 0 means zero it. */
  quantity: z.number().int().min(0),
  ensure_managed: z.boolean().optional(),
  location_ids: z.array(z.string().min(1)).optional(),
})

export const BulkUpdateProductsSchema = z
  .object({
    products: z.array(ProductTargetSchema).optional(),
    selector: SelectorSchema.optional(),
    product_update: z.record(z.string(), z.any()).optional(),
    variant_update: z.record(z.string(), z.any()).optional(),
    set_inventory: InventorySchema.optional(),
    dry_run: z.boolean().optional(),
  })
  .refine((b) => b.products?.length || b.selector, {
    message: "Pass products, a selector, or both — there is nothing to target.",
  })
  .refine(
    (b) =>
      b.product_update ||
      b.variant_update ||
      b.set_inventory ||
      b.products?.some((p) => p.update || p.variants?.some((v) => v.update)),
    { message: "Nothing to change — pass at least one update or set_inventory." }
  )

export type BulkUpdateProductsReq = z.infer<typeof BulkUpdateProductsSchema>
