import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../../modules/visual-flows"
import VisualFlowService from "../../../../../modules/visual-flows/service"
import { z } from "zod"

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
