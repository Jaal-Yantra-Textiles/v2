import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { changeOrderItemDesign } from "../../../../../../workflows/designs/change-order-item-design"

/**
 * POST /admin/designs/orders/:lineItemId/design
 *
 * Attach, replace or detach the design behind an order line item (#1918).
 *
 * `{ "design_id": "01K..." }`  attaches or replaces
 * `{ "design_id": null }`      DETACHES — the item keeps its
 *                              `metadata.design_id` provenance, so "unlinked"
 *                              stays distinguishable from "never had one"
 *
 * The customer is emailed what changed, with each garment's real production
 * state. Pass `notify: false` for a correction they should not see, and
 * `dry_run: true` to preview the change and the email without doing either.
 *
 * ⚠️ This is the ORDER line item link (#1919), not the cart one. The older
 * `design_line_item` link dies at checkout and cannot be re-pointed afterwards,
 * which is the whole reason this route exists.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { lineItemId } = req.params
  const body = (req.validatedBody ?? {}) as {
    design_id?: string | null
    notify?: boolean
    dry_run?: boolean
  }

  // `design_id` must be PRESENT — omitting it is ambiguous between "detach" and
  // "I forgot the field", and one of those silently unlinks a paid-for garment.
  if (!Object.prototype.hasOwnProperty.call(body, "design_id")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "`design_id` is required. Send a design id to attach, or an explicit null to detach."
    )
  }

  try {
    const result = await changeOrderItemDesign(req.scope, {
      line_item_id: lineItemId,
      design_id: body.design_id ?? null,
      notify: body.notify,
      dry_run: body.dry_run,
    })
    res.json(result)
  } catch (e: any) {
    if (/does not exist/i.test(e?.message ?? "")) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, e.message)
    }
    throw e
  }
}
