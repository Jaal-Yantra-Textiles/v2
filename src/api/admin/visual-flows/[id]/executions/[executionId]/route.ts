import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../../../modules/visual_flows"
import VisualFlowService from "../../../../../../modules/visual_flows/service"

/**
 * GET /admin/visual-flows/:id/executions/:executionId
 * Get a single execution with logs
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { executionId } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const execution = await service.getExecutionWithLogs(executionId)
    
    if (!execution) {
      return res.status(404).json({ error: "Execution not found" })
    }
    
    res.json({ execution })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
