/**
 * @file Admin API route for listing visual flow executions
 * @module api/admin/visual-flows/[id]/executions
 *
 * This route provides functionality to list and filter executions of a specific visual flow.
 * Executions represent individual runs of a visual flow with their current status and metadata.
 *
 * @example
 * // List all executions for flow with ID "flow_123"
 * GET /admin/visual-flows/flow_123/executions
 *
 * @example
 * // List only completed executions (limit 20)
 * GET /admin/visual-flows/flow_123/executions?status=completed&limit=20
 *
 * @example
 * // List failed executions with pagination (offset 10, limit 15)
 * GET /admin/visual-flows/flow_123/executions?status=failed&offset=10&limit=15
 *
 * @example
 * // List pending executions (default limit 50)
 * GET /admin/visual-flows/flow_123/executions?status=pending
 *
 * @returns {Object} Response object containing:
 *   - executions: Array of execution objects
 *   - count: Total number of executions matching filters
 *   - limit: Number of executions returned per page
 *   - offset: Current pagination offset
 *
 * @throws {400} When validation fails or invalid parameters are provided
 * @throws {404} When the visual flow with specified ID doesn't exist
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../../modules/visual_flows"
import VisualFlowService from "../../../../../modules/visual_flows/service"
import { z } from "@medusajs/framework/zod"

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
        order: { created_at: "DESC" },
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
