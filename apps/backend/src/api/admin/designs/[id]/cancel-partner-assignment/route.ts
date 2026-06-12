import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { cancelPartnerAssignmentWorkflow } from "../../../../../workflows/designs/cancel-partner-assignment"
import type { CancelPartnerAssignmentReq } from "./validators"

/**
 * POST /admin/designs/:id/cancel-partner-assignment
 *
 * Cancels a partner's assignment for a design. The work itself is done by
 * `cancelPartnerAssignmentWorkflow` (steps + compensation):
 * 1. Cancel the partner's active production runs (+ their open tasks)
 * 2. Optionally unlink the partner
 *
 * Body: { partner_id: string, unlink?: boolean }
 *
 * Cancellation is the run's own state — partner_status derives from the
 * cancelled run. Re-assigning via a new production run supersedes it.
 */
export const POST = async (
  req: MedusaRequest<CancelPartnerAssignmentReq>,
  res: MedusaResponse
) => {
  const designId = req.params.id
  // Body shape is enforced by validateAndTransformBody in middlewares.ts
  const { partner_id, unlink } = req.validatedBody

  // Validate the design exists and the partner is actually linked.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "partners.id"],
  })
  const design = designs?.[0]
  if (!design) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found")
  }
  if (!(design.partners || []).some((p: any) => p.id === partner_id)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner is not linked to this design"
    )
  }

  const { result } = await cancelPartnerAssignmentWorkflow(req.scope).run({
    input: { design_id: designId, partner_id, unlink },
  })

  res.json({
    design_id: designId,
    partner_id,
    cancelled_tasks: result.cancelled_tasks,
    cancelled_runs: result.cancelled_runs,
    unlinked: result.unlinked,
    message: `Partner assignment cancelled. ${result.cancelled_tasks} task(s) cancelled.${result.cancelled_runs ? ` ${result.cancelled_runs} run(s) cancelled.` : ""}${result.unlinked ? " Partner unlinked." : " Partner still linked — ready for production run."}`,
  })
}
