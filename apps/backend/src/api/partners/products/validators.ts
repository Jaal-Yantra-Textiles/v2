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
  })
  .strict()

export type PartnerProductSpecReqType = z.infer<typeof PartnerProductSpecReq>
