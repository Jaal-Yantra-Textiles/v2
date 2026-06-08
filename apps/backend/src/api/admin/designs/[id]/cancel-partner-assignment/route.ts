import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { cancelPartnerAssignmentWorkflow } from "../../../../../workflows/designs/cancel-partner-assignment"

/**
 * POST /admin/designs/:id/cancel-partner-assignment
 *
 * Cancels a partner's assignment for a design. The work itself is done by
 * `cancelPartnerAssignmentWorkflow` (steps + compensation):
 * 1. Cancel the legacy v1 send-to-partner workflow transaction (if any)
 * 2. Cancel non-terminal v1 partner-workflow tasks
 * 3. Cancel the partner's active production runs (+ their open tasks)
 * 4. Reset partner_* metadata and set the (legacy) cancel marker
 * 5. Optionally unlink the partner
 *
 * Body: { partner_id: string, unlink?: boolean }
 *
 * After cancellation the design can be re-assigned via a production run
 * (which clears the marker; status then derives from the new run).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id
  const { partner_id, unlink = false } = (req.body || {}) as {
    partner_id?: string
    unlink?: boolean
  }

  if (!partner_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "partner_id is required")
  }

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
    transaction_id: result.transaction_id,
    cancelled_tasks: result.cancelled_tasks,
    cancelled_runs: result.cancelled_runs,
    unlinked: result.unlinked,
    message: `Partner assignment cancelled.${result.transaction_id ? ` Workflow transaction ${result.transaction_id} cancelled.` : ""} ${result.cancelled_tasks} task(s) cancelled.${result.cancelled_runs ? ` ${result.cancelled_runs} run(s) cancelled.` : ""}${result.unlinked ? " Partner unlinked." : " Partner still linked — ready for production run."}`,
  })
}
