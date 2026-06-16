import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
import { convertDesignOrderToOrder } from "../../../../../../workflows/designs/convert-design-order"

/**
 * POST /admin/designs/orders/:lineItemId/convert
 *
 * #404 (#31) PR-A — convert a design order (a cart with design line items, no
 * backing order yet) into a real, shippable order, admin-side.
 *
 *   payment_mode = "prepaid" (default) → order is marked paid via the system
 *                  payment provider (payment_status=captured).
 *   payment_mode = "cod"               → order is created unpaid; reconciled
 *                  later via Shiprocket remittance (P4).
 *
 * Body validated inline (tiny, optional) — mirrors the admin orders LIST route.
 */
const ConvertDesignOrderBody = z.object({
  payment_mode: z.enum(["prepaid", "cod"]).optional(),
})

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { lineItemId } = req.params
  const { payment_mode } = ConvertDesignOrderBody.parse(
    (req.body as Record<string, unknown>) ?? {}
  )

  const result = await convertDesignOrderToOrder(req.scope, {
    lineItemId,
    paymentMode: payment_mode,
    capturedBy: (req as any).auth_context?.actor_id,
  })

  res.status(200).json({ design_order_conversion: result })
}
