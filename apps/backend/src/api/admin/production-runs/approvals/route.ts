import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { applyRunApprovals } from "../../../../workflows/production-runs/approve-run-output"

/**
 * POST /admin/production-runs/approvals — review what completed runs produced
 * (#1805).
 *
 * `{ run_ids[], decision: "approve" | "reject", reason?, dry_run? }`
 *
 * Approve creates the catalogue product (once per DESIGN, however many of its
 * runs are in the selection); reject records the refusal and creates nothing.
 * Everything that makes this more than a loop — the per-design idempotency, the
 * resolved currency, the per-run report — lives in `applyRunApprovals`, whose
 * docblock has the argument.
 *
 * 🔑 It answers 200 with a REPORT, not a bare success. A batch where 3 of 12
 * runs were skipped because their design already had a product is a normal
 * outcome and the operator has to be able to see it (#1263).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const body = req.validatedBody as any

  const result = await applyRunApprovals(req.scope, {
    runIds: body.run_ids,
    decision: body.decision,
    reason: body.reason ?? null,
    // Who decided. `auth_context` is the admin acting; "system" only when a
    // job ever calls this.
    actorId: req.auth_context?.actor_id ?? null,
    dryRun: Boolean(body.dry_run),
  })

  res.status(200).json({ run_approvals: result })
}
