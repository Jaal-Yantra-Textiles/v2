import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
import { produceDesignsAsWorkOrder } from "../../../../workflows/designs/produce-designs-as-work-order"

/**
 * POST /admin/designs/produce
 *
 * #826 — "send to production" straight from the designs list, WITHOUT a
 * commissioning (sales) order. Pick N designs + a partner → one production run
 * per design (born sent_to_partner) collated into ONE kind=design work-order.
 *
 * Contrast with POST /admin/orders/:id/design/produce, which fans runs out of a
 * commissioning order's line items (there IS a customer/sale). This path is the
 * no-customer analog for when the operator just wants a partner to make things.
 *
 * #1263 — it now dispatches each design with its own `template_ids` rather than
 * creating runs that claim to have been sent and carry no tasks. The response
 * reports per design what was dispatched and what was not.
 */
/**
 * #1263 — templates are per DESIGN. A batch-wide set would be wrong for most
 * runs (the #1261 recovery: 7 runs, 4 different sets), and ids rather than
 * names because dispatch refuses an ambiguous name (#1262).
 *
 * `template_ids` at the top level is the fallback for designs without their
 * own selection — convenient when a batch genuinely does share one process.
 */
const ProduceBody = z
  .object({
    design_ids: z.array(z.string()).min(1).optional(),
    designs: z
      .array(
        z.object({
          design_id: z.string().min(1),
          template_ids: z.array(z.string().min(1)).optional(),
          quantity: z.number().int().positive().optional(),
        })
      )
      .min(1)
      .optional(),
    partner_id: z.string().min(1),
    template_ids: z.array(z.string().min(1)).optional(),
    /** Preview which design would get which templates; creates nothing. */
    dry_run: z.boolean().optional(),
    /**
     * #1597 — where these designs' lines land. Omitted means `partner-open`:
     * join the partner's most recent open collated work-order instead of
     * minting another. Pass `"new"` for a batch that must be billed on its own.
     */
    collate: z.enum(["partner-open", "new"]).optional(),
    collate_within_days: z.number().int().positive().max(365).optional(),
  })
  .refine((b) => Boolean(b.design_ids?.length || b.designs?.length), {
    message: "Pass designs (preferred, per-design templates) or design_ids.",
    path: ["designs"],
  })

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const body = ProduceBody.parse((req.body as Record<string, unknown>) ?? {})

  const designIds =
    body.design_ids?.length
      ? body.design_ids
      : (body.designs || []).map((d) => d.design_id)

  const result = await produceDesignsAsWorkOrder(
    req.scope,
    designIds,
    body.partner_id,
    {
      selections: body.designs,
      templateIds: body.template_ids,
      dryRun: body.dry_run,
      collate: body.collate,
      collateWithinDays: body.collate_within_days,
    }
  )

  res.status(200).json({ design_production: result })
}
