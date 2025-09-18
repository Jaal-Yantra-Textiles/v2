import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import { updateDesignWorkflow } from "../../../../../workflows/designs/update-design"
import { setDesignStepSuccessWorkflow } from "../../../../../workflows/designs/design-steps"

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

  // Validate body: accept decimal value for inventory_used
  const body = (req.body as any) || {}
  let inventoryUsedRaw = body.inventory_used
  if (inventoryUsedRaw === undefined || inventoryUsedRaw === null || inventoryUsedRaw === "") {
    return res.status(400).json({ error: "inventory_used is required" })
  }

  // Allow string or number; parse to number
  const inventoryUsed = typeof inventoryUsedRaw === "string" ? Number(inventoryUsedRaw) : inventoryUsedRaw
  if (typeof inventoryUsed !== "number" || Number.isNaN(inventoryUsed)) {
    return res.status(400).json({ error: "inventory_used must be a number" })
  }

  // Load tasks linked to this design (to ensure the design is in a workflow context)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskLinksResult = await query.graph({
    entity: "designs",
    fields: ["id", "tasks.*"],
    filters: { id: designId },
  })
  const taskLinks = taskLinksResult.data || []
  if (!taskLinks.length) {
    return res.status(404).json({ error: `Design ${designId} not found` })
  }

  // Update design metadata with inventory used
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: designId,
      metadata: {
        partner_inventory_used: inventoryUsed,
        partner_inventory_reported_at: new Date().toISOString(),
        partner_status: "inventory_reported",
      },
    },
  })
  if (errors && errors.length) {
    return res.status(500).json({ error: "Failed to update design", details: errors })
  }

  // Signal the inventory step success so the workflow can proceed to completion gate
  const { errors: stepErrors } = await setDesignStepSuccessWorkflow(req.scope).run({
    input: {
      stepId: "await-design-inventory",
      updatedDesign: result[0],
    },
  })
  if (stepErrors && stepErrors.length) {
    return res.status(500).json({ error: "Failed to update workflow", details: stepErrors })
  }

  return res.status(200).json({
    message: "Inventory used recorded successfully",
    design: result[0],
  })
}
