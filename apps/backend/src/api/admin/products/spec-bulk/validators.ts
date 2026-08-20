import { z } from "zod"

import { PartnerProductSpecReq } from "../../../partners/products/validators"
import { BULK_SPEC_MAX_PRODUCTS } from "../../../../workflows/products/bulk-upsert-product-specs"

/**
 * Body validation for the bulk production-spec write, shared by the admin route
 * and its partner mirror.
 *
 * 🔑 The per-row spec shape is `PartnerProductSpecReq` itself — imported, not
 * re-declared. A spec means one thing on this platform; a second copy of its
 * rules here would be one edit away from the batch route accepting a spec the
 * single route rejects, and the batch is exactly where that divergence would
 * reach a hundred products before anyone noticed.
 *
 * That import direction (admin ← partners) looks backwards and is deliberate:
 * the partner validator is the one the product-spec module's own tests pin, so
 * it is the definition rather than a copy of one.
 */
export const BulkProductSpecReq = z
  .object({
    products: z
      .array(
        z
          .object({
            product_id: z.string().trim().min(1),
            spec: PartnerProductSpecReq.optional(),
          })
          .strict()
      )
      .min(1)
      .max(BULK_SPEC_MAX_PRODUCTS),
    // Applied to every row that carries no `spec` of its own. This is the
    // common case: one weave and one palette across a whole run.
    spec: PartnerProductSpecReq.optional(),
    dry_run: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => !!body.spec || body.products.every((p) => !!p.spec),
    {
      message:
        "Provide a batch-wide `spec`, or a `spec` on every product row. A row with neither has nothing to write.",
      path: ["spec"],
    }
  )

export type BulkProductSpecReqType = z.infer<typeof BulkProductSpecReq>
