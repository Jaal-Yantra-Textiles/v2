import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import { z } from "zod"
import { completePartnerDesignWorkflow } from "../../../../../workflows/designs/complete-partner-design"
import { setDesignStepFailedWorkflow, setDesignStepSuccessWorkflow } from "../../../../../workflows/designs/design-steps"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const designId = req.params.designId

  // Auth partner
  const adminId = req.auth_context.actor_id
  const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partnerAdmin) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  // Parse optional consumptions payload for inventory adjustments
  const BodySchema = z.object({
    consumptions: z
      .array(
        z.object({
          inventory_item_id: z.string(),
          quantity: z.number().positive().optional(),
          location_id: z.string().optional(),
        })
      )
      .optional(),
  })
  const parsed = BodySchema.safeParse((req as any).validatedBody || (req.body as any))
  const consumptions = parsed.success ? parsed.data.consumptions : undefined

  // Delegate to workflow that adjusts inventory, updates design/tasks, and signals steps
  const { result, errors } = await completePartnerDesignWorkflow(req.scope).run({
    input: { design_id: designId, consumptions },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to complete design", details: errors })
  }

  // Signal gates from the route to avoid duplicate runAsStep invocations within the workflow
  // First, signal inventory-reported gate in case the workflow expects it prior to completion
  try {
    await setDesignStepSuccessWorkflow(req.scope).run({
      input: { stepId: "await-design-inventory", updatedDesign: (result as any)?.updatedDesign },
    })
  } catch (_) {}
  try {
    await setDesignStepFailedWorkflow(req.scope).run({
      input: { stepId: "await-design-redo", updatedDesign: (result as any)?.updatedDesign },
    })
  } catch (_) {}
  try {
    await setDesignStepFailedWorkflow(req.scope).run({
      input: { stepId: "await-design-refinish", updatedDesign: (result as any)?.updatedDesign },
    })
  } catch (_) {}
  try {
    await setDesignStepSuccessWorkflow(req.scope).run({
      input: { stepId: "await-design-completed", updatedDesign: (result as any)?.updatedDesign },
    })
  } catch (_) {}

  return res.status(200).json({ message: "Design marked as completed", result })
}
