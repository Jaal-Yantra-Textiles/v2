/**
 * @file Partner API route for completing designs
 * @description Provides endpoints for partners to mark designs as completed and update inventory
 * @module API/Partners/Designs
 */

/**
 * @typedef {Object} ConsumptionItem
 * @property {string} inventory_item_id - The ID of the inventory item being consumed
 * @property {number} [quantity] - The quantity of the inventory item to consume (must be positive)
 * @property {string} [location_id] - The ID of the location where the inventory is being consumed
 */

/**
 * @typedef {Object} CompleteDesignRequest
 * @property {ConsumptionItem[]} [consumptions] - Optional array of inventory consumptions to apply when completing the design
 */

/**
 * @typedef {Object} DesignStep
 * @property {string} id - The unique identifier of the design step
 * @property {string} status - The status of the step (e.g., "completed", "failed")
 * @property {Date} updated_at - When the step was last updated
 */

/**
 * @typedef {Object} Design
 * @property {string} id - The unique identifier of the design
 * @property {string} status - The status of the design (e.g., "completed", "in_progress")
 * @property {string} partner_id - The ID of the partner associated with the design
 * @property {Date} created_at - When the design was created
 * @property {Date} updated_at - When the design was last updated
 * @property {DesignStep[]} steps - Array of steps associated with the design
 */

/**
 * @typedef {Object} CompleteDesignResponse
 * @property {string} message - A success message indicating the design was marked as completed
 * @property {Design} design - The updated design object
 * @property {Object} result - Additional result data from the workflow
 */

/**
 * Complete a design and optionally update inventory
 * @route POST /partners/designs/:designId/complete
 * @group Design - Operations related to designs
 * @param {string} designId.path.required - The ID of the design to complete
 * @param {CompleteDesignRequest} request.body.required - Optional consumptions data for inventory adjustments
 * @returns {CompleteDesignResponse} 200 - Design marked as completed with updated design object
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Failed to complete design with error details
 *
 * @example request
 * POST /partners/designs/design_123456789/complete
 * {
 *   "consumptions": [
 *     {
 *       "inventory_item_id": "inv_item_123",
 *       "quantity": 2,
 *       "location_id": "loc_456"
 *     },
 *     {
 *       "inventory_item_id": "inv_item_789",
 *       "quantity": 1
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "message": "Design marked as completed",
 *   "design": {
 *     "id": "design_123456789",
 *     "status": "completed",
 *     "partner_id": "partner_123",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T12:00:00Z",
 *     "steps": [
 *       {
 *         "id": "await-design-inventory",
 *         "status": "completed",
 *         "updated_at": "2023-01-02T12:00:00Z"
 *       },
 *       {
 *         "id": "await-design-completed",
 *         "status": "completed",
 *         "updated_at": "2023-01-02T12:00:00Z"
 *       }
 *     ]
 *   },
 *   "result": {
 *     "updatedDesign": {
 *       "id": "design_123456789",
 *       "status": "completed"
 *     },
 *     "consumptionsApplied": [
 *       {
 *         "inventory_item_id": "inv_item_123",
 *         "quantity": 2,
 *         "location_id": "loc_456"
 *       }
 *     ]
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { z } from "@medusajs/framework/zod"
import { completePartnerDesignWorkflow } from "../../../../../workflows/designs/complete-partner-design"
import { setDesignStepFailedWorkflow, setDesignStepSuccessWorkflow } from "../../../../../workflows/designs/design-steps"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const designId = req.params.designId

  // Auth partner
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
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

  // Backward-compatible response: expose updated design at top-level `design`
  const updatedDesign = (result as any)?.updatedDesign
  const design = Array.isArray(updatedDesign) ? updatedDesign[0] : updatedDesign
  return res.status(200).json({ message: "Design marked as completed", design, result })
}
