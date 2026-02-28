/**
 * Duplicate a visual flow by ID
 *
 * This endpoint creates a copy of an existing visual flow with a new ID.
 * The new flow will have the same steps, configuration, and metadata as the original,
 * but with a different ID and optionally a new name.
 *
 * @example
 * // Duplicate a flow with ID "flow_123" and keep the original name
 * POST /admin/visual-flows/flow_123/duplicate
 * {
 *   // No body needed if keeping original name
 * }
 *
 * @example
 * // Duplicate a flow with ID "flow_123" and specify a new name
 * POST /admin/visual-flows/flow_123/duplicate
 * {
 *   "name": "New Flow Name"
 * }
 *
 * @response
 * {
 *   "flow": {
 *     "id": "flow_456",
 *     "name": "New Flow Name", // or original name if not specified
 *     "steps": [...], // Same steps as original
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 *
 * @throws {400} If the flow ID is invalid or doesn't exist
 * @throws {400} If validation fails (e.g., invalid name format)
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../../modules/visual_flows"
import VisualFlowService from "../../../../../modules/visual_flows/service"
import { z } from "@medusajs/framework/zod"

const duplicateSchema = z.object({
  name: z.string().optional(),
})

/**
 * POST /admin/visual-flows/:id/duplicate
 * Duplicate a visual flow
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const data = duplicateSchema.parse(req.body)
    
    const flow = await service.duplicateFlow(id, data.name)
    
    res.status(201).json({ flow })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.errors })
    } else {
      res.status(400).json({ error: error.message })
    }
  }
}
