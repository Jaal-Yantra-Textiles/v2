import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../../modules/visual-flows"
import VisualFlowService from "../../../../../modules/visual-flows/service"
import { z } from "zod"

const listQuerySchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
})

/**
 * GET /admin/visual-flows/:id/executions
 * List executions for a flow
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const query = listQuerySchema.parse(req.query)
    
    const filters: Record<string, any> = { flow_id: id }
    if (query.status) filters.status = query.status
    
    const [executions, count] = await service.listAndCountVisualFlowExecutions(
      filters as any,
      {
        take: query.limit,
        skip: query.offset,
        order: { started_at: "DESC" },
      }
    )
    
    res.json({
      executions,
      count,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
