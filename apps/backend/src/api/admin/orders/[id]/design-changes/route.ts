import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { changeOrderDesigns } from "../../../../../workflows/designs/change-order-item-design"
import type { ChangeOrderDesigns } from "./validators"

/**
 * POST /admin/orders/:id/design-changes
 *
 * Change the designs on an order — every line in one call, and ONE email.
 *
 * The per-line door (`/admin/designs/orders/:lineItemId/design`) still exists
 * and still works; it is now a batch of one. What it cannot do is tell the
 * customer about three re-points as one decision: called three times it sends
 * three emails, each describing a third of what happened.
 *
 * This is the shape Medusa uses for an order edit — actions accumulate on one
 * change and exactly one `order-edit.confirmed` is emitted when it is applied,
 * however many lines moved.
 *
 * ⚠️ Like the single-line route, this does NOT edit the ORDER: titles, prices,
 * quantities and totals are untouched and no order edit is created. It moves
 * which design each line stands for.
 *
 * `dry_run: true` previews the change AND the email — the notice comes back
 * fully built, which is how the admin UI quotes the customer's sentence before
 * anything is sent.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const orderId = req.params.id
  const body = (req.validatedBody ?? {}) as ChangeOrderDesigns

  try {
    /**
     * `order_id` is passed DOWN rather than checked on the way back: the batch
     * is addressed by order, and a line belonging to a different one has to be
     * refused before any link moves — not reported after it has applied cleanly
     * to whichever order those lines really belong to.
     */
    const result = await changeOrderDesigns(req.scope, {
      changes: body.changes,
      order_id: orderId,
      production: body.production,
      notify: body.notify,
      dry_run: body.dry_run,
    })

    res.json(result)
  } catch (e: any) {
    // The caller-mistake cases already arrive as MedusaError — the workflow
    // raises them itself rather than leaving the route to pattern-match prose.
    if (e instanceof MedusaError) throw e
    if (/does not exist/i.test(e?.message ?? "")) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, e.message)
    }
    throw e
  }
}
