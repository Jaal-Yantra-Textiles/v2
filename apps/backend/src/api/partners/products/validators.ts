import { z } from "@medusajs/framework/zod"

// Minimal validator to accept a product payload and target store
// We rely on createProductsWorkflow to validate deeper product structure
export const PartnerCreateProductReq = z
  .object({
    store_id: z.string().min(1, "store_id is required"),
    product: z.record(z.string(), z.any()),
  })
  .strict()

export type PartnerCreateProductReqType = z.infer<typeof PartnerCreateProductReq>

// #859 S3 (#862): the partner-editable "made-to-order & maker story" fields for
// an artisan product. All optional — a partner may set only a maker story, or
// only flip made-to-order, etc. `null` explicitly clears a field.
export const PartnerArtisanProductDetailReq = z
  .object({
    made_to_order: z.boolean().optional(),
    lead_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    lead_time_label: z.string().trim().max(120).nullable().optional(),
    min_order_quantity: z.number().int().min(1).max(100000).nullable().optional(),
    maker_story: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()

export type PartnerArtisanProductDetailReqType = z.infer<
  typeof PartnerArtisanProductDetailReq
>

/**
 * #1342: the partner-authored production spec for a product — the weave, its
 * measured parameters, the colour palette, and any spec the catalog doesn't
 * cover.
 *
 * Shape only. Whether a parameter is IN RANGE for the chosen technique is a
 * business rule and lives in `upsert-product-spec.ts`, which is the only layer
 * that knows the catalog.
 *
 * `colors` and `fields` REPLACE what is stored when present, so omitting a key
 * (leave alone) and sending `[]` (delete every entry) mean different things.
 */
const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const PartnerProductSpecColorReq = z
  .object({
    name: z.string().trim().min(1).max(120),
    hex_code: z
      .string()
      .trim()
      .regex(HEX, "Use a hex colour like #C9A227")
      .nullable()
      .optional(),
    usage_notes: z.string().trim().max(500).nullable().optional(),
    order: z.number().int().min(0).max(999).optional(),
    available: z.boolean().optional(),
  })
  .strict()

export const PartnerProductSpecFieldReq = z
  .object({
    key: z.string().trim().min(1).max(60),
    label: z.string().trim().max(120).nullable().optional(),
    value: z.string().trim().max(500).nullable().optional(),
    order: z.number().int().min(0).max(999).optional(),
  })
  .strict()

/**
 * A partner-defined selectable option group and its values.
 *
 * The partner names the axis, so this schema deliberately constrains nothing
 * about WHAT the choice is — "Embroidery", "Border", "Pallu finish" are all the
 * same shape. What it does constrain is size: an option group with 200 values
 * is not a choice, it is a search box, and a made-to-order page that renders
 * one has stopped being usable.
 */
export const PartnerProductSpecOptionValueReq = z
  .object({
    label: z.string().trim().min(1).max(160),
    note: z.string().trim().max(500).nullable().optional(),
    order: z.number().int().min(0).max(999).optional(),
    available: z.boolean().optional(),
  })
  .strict()

export const PartnerProductSpecOptionReq = z
  .object({
    key: z.string().trim().min(1).max(60),
    label: z.string().trim().max(120).nullable().optional(),
    help_text: z.string().trim().max(500).nullable().optional(),
    required: z.boolean().optional(),
    order: z.number().int().min(0).max(999).optional(),
    // A group with no values is not "no choice offered", it is a broken choice
    // the customer cannot satisfy — and if it is `required` too, the product
    // becomes unorderable. Rejected at the door rather than at add-to-cart.
    values: z.array(PartnerProductSpecOptionValueReq).min(1).max(40),
  })
  .strict()

export const PartnerProductSpecReq = z
  .object({
    weave_technique: z.string().trim().max(60).nullable().optional(),
    weave_label: z.string().trim().max(160).nullable().optional(),
    // Values are numbers per the catalog's param defs; ranges checked in the
    // workflow against the technique that was actually chosen.
    params: z.record(z.string(), z.number()).nullable().optional(),
    finishes: z.array(z.string().trim().min(1).max(120)).max(20).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    accepting_custom_orders: z.boolean().optional(),
    custom_order_lead_time_days: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullable()
      .optional(),
    colors: z.array(PartnerProductSpecColorReq).max(60).optional(),
    fields: z.array(PartnerProductSpecFieldReq).max(40).optional(),
    // Replaces wholesale when present, exactly like colors/fields.
    options: z.array(PartnerProductSpecOptionReq).max(12).optional(),
  })
  .strict()

export type PartnerProductSpecReqType = z.infer<typeof PartnerProductSpecReq>

/**
 * #1380 step 1 — body validation for the two partner create paths that had
 * NONE. Both passed `req.body as Record<string, any>` straight into
 * `createProductsWorkflow`, which is how the only Zod-guarded create path ended
 * up being the legacy route everyone assumed was the disposable one.
 *
 * Deliberately permissive about the product's interior: `createProductsWorkflow`
 * is still the authority on variant/option/price shape, and tightening that here
 * would reject payloads the partner UI sends today. What these add is the outer
 * guarantee — a title exists, and a typo'd top-level key is a 400 rather than a
 * silently ignored field.
 */
export const PartnerStoreCreateProductReq = z
  .object({
    title: z.string().trim().min(1, "title is required"),
  })
  .passthrough()

export type PartnerStoreCreateProductReqType = z.infer<
  typeof PartnerStoreCreateProductReq
>

/**
 * Quick-create takes a flat, closed payload — every field it understands is
 * listed here, so `.strict()` is safe and a misspelled `stock` or `qty` fails
 * loudly instead of silently creating a product with no stock.
 */
export const PartnerQuickCreateProductReq = z
  .object({
    title: z.string().trim().min(1, "title is required"),
    description: z.string().nullable().optional(),
    thumbnail: z.string().nullable().optional(),
    images: z.array(z.string()).optional(),
    price: z.number().min(0, "price must be a non-negative number"),
    stock_quantity: z
      .number()
      .min(0, "stock_quantity must be a non-negative number")
      .optional(),
    status: z.string().optional(),
  })
  .strict()

export type PartnerQuickCreateProductReqType = z.infer<
  typeof PartnerQuickCreateProductReq
>
