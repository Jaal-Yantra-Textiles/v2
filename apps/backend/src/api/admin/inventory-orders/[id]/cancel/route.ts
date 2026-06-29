/**
 * @route POST /admin/inventory-orders/:id/cancel
 * @scope admin
 *
 * Cancel an inventory order (#778 C2/C4). Reverses any stock that prior
 * (partial or full) deliveries posted, cancels still-open tasks, flips the
 * status to "Cancelled" while stamping the cancellation audit columns, and
 * mirrors the cancel onto the unified core order. Idempotent guard: cancelling
 * an already-Cancelled order returns 409.
 *
 * Body: { reason?: string }
 * Success: 200 -> { success, orderId, reversedLevels }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { cancelInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/cancel-inventory-order";

const cancelBodySchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id;
  const parsed = cancelBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const cancelledBy = req.auth_context?.actor_id || "admin";

  const { result, errors } = await cancelInventoryOrderWorkflow(req.scope).run({
    input: {
      orderId: id,
      reason: parsed.data.reason ?? null,
      cancelledBy,
    },
    throwOnError: false,
  });

  if (errors && errors.length > 0) {
    const err = errors[0]?.error as any;
    // Surface the cancel-guard (already-Cancelled / not-found) as a proper status.
    if (err instanceof MedusaError || err?.type) {
      const type = err.type || err?.constructor?.name;
      if (type === MedusaError.Types.NOT_FOUND) {
        return res.status(404).json({ message: err.message });
      }
      if (type === MedusaError.Types.NOT_ALLOWED) {
        return res.status(409).json({ message: err.message });
      }
    }
    return res.status(400).json({ errors });
  }

  return res.status(200).json(result);
};
