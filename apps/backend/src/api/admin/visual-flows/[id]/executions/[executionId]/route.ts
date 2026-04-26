/**
 * @file Admin API route for retrieving visual flow execution details with logs
 *
 * This route provides detailed information about a specific execution of a visual flow,
 * including all associated logs for debugging and monitoring purposes.
 *
 * @example
 * // Request a specific execution
 * GET /admin/visual-flows/vf_123456789/executions/ex_987654321
 *
 * @example
 * // Successful response
 * {
 *   "execution": {
 *     "id": "ex_987654321",
 *     "visual_flow_id": "vf_123456789",
 *     "status": "completed",
 *     "created_at": "2024-01-01T00:00:00.000Z",
 *     "updated_at": "2024-01-01T00:01:00.000Z",
 *     "logs": [
 *       {
 *         "id": "log_123",
 *         "message": "Execution started",
 *         "level": "info",
 *         "timestamp": "2024-01-01T00:00:00.000Z"
 *       },
 *       {
 *         "id": "log_456",
 *         "message": "Processing step 1",
 *         "level": "info",
 *         "timestamp": "2024-01-01T00:00:30.000Z"
 *       }
 *     ]
 *   }
 * }
 *
 * @example
 * // Error response (execution not found)
 * {
 *   "error": "Execution not found"
 * }
 *
 * @example
 * // Error response (invalid request)
 * {
 *   "error": "Invalid execution ID format"
 * }
 */
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
