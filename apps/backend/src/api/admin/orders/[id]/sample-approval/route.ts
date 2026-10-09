/**
 * @route POST /admin/orders/:id/sample-approval
 * @scope admin
 *
 * Record the buyer's verdict on a first sample of a made-to-order deal. On a
 * deal whose balance trigger is `sample_approved`, approval raises the balance
 * and returns the buyer's pay link; a rejection is recorded and asks for
 * nothing.
 *
 * Body: { production_run_id, decision: "approved" | "rejected", notes?, confirm? }
 * `confirm: true` is required for an approval, because it asks a real buyer
 * for money.
 * Success: 200 -> { sample_decision }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { decideOrderSample } from "../../../../../lib/payments/order-sample-decision";

const bodySchema = z.object({
  production_run_id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().min(1).optional(),
  confirm: z.boolean().optional(),
});

/** The logged-in admin's email, recorded on the decision. */
const resolveActor = async (req: AuthenticatedMedusaRequest): Promise<string | null> => {
  const actorId = (req as any).auth_context?.actor_id;
  if (!actorId) return null;
  try {
    const userService: any = req.scope.resolve(Modules.USER);
    const user = await userService.retrieveUser(actorId);
    return user?.email ?? actorId;
  } catch {
    return actorId;
  }
};

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }
  if (parsed.data.decision === "approved" && parsed.data.confirm !== true) {
    return res.status(400).json({
      message:
        "Approving the sample asks the buyer for the balance. Pass confirm:true once the buyer has approved it.",
    });
  }

  try {
    const result = await decideOrderSample(req.scope, {
      order_id: req.params.id,
      production_run_id: parsed.data.production_run_id,
      decision: parsed.data.decision,
      notes: parsed.data.notes ?? null,
      decided_by: await resolveActor(req),
    });
    return res.status(200).json({ sample_decision: result });
  } catch (err: any) {
    const type = err?.type;
    if (type === MedusaError.Types.NOT_FOUND) return res.status(404).json({ message: err.message });
    if (type === MedusaError.Types.NOT_ALLOWED) return res.status(409).json({ message: err.message });
    if (type === MedusaError.Types.INVALID_DATA) return res.status(400).json({ message: err.message });
    throw err;
  }
}
