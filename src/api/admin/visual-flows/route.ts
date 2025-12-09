import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../modules/visual_flows"
import VisualFlowService from "../../../modules/visual_flows/service"
import { z } from "zod"
import { createVisualFlowWorkflow } from "../../../workflows/visual-flows"

// Validation schemas
const createFlowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  trigger_type: z.enum(["event", "schedule", "webhook", "manual", "another_flow"]),
  trigger_config: z.record(z.any()).optional(),
  canvas_state: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  operations: z.array(z.object({
    operation_key: z.string(),
    operation_type: z.string(),
    name: z.string().optional(),
    options: z.record(z.any()).optional(),
    position_x: z.number().optional(),
    position_y: z.number().optional(),
    sort_order: z.number().optional(),
  })).optional(),
  connections: z.array(z.object({
    source_id: z.string(),
    source_handle: z.string().optional(),
    target_id: z.string(),
    target_handle: z.string().optional(),
    connection_type: z.enum(["success", "failure", "default"]).optional(),
    condition: z.record(z.any()).optional(),
  })).optional(),
})

const listQuerySchema = z.object({
  status: z.enum(["active", "inactive", "draft"]).optional(),
  trigger_type: z.enum(["event", "schedule", "webhook", "manual", "another_flow"]).optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
})

/**
 * GET /admin/visual-flows
 * List all visual flows
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const query = listQuerySchema.parse(req.query)
    
    const filters: Record<string, any> = {}
    if (query.status) filters.status = query.status
    if (query.trigger_type) filters.trigger_type = query.trigger_type
    
    const [flows, count] = await service.listAndCountVisualFlows(
      filters,
      {
        take: query.limit,
        skip: query.offset,
        order: { created_at: "DESC" },
      }
    )
    
    res.json({
      flows,
      count,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}

/**
 * POST /admin/visual-flows
 * Create a new visual flow using workflow
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const data = createFlowSchema.parse(req.body)
    
    // Use workflow for transactional creation with rollback support
    const { result: flow, errors } = await createVisualFlowWorkflow(req.scope).run({
      input: {
        name: data.name,
        description: data.description,
        status: data.status,
        trigger_type: data.trigger_type,
        trigger_config: data.trigger_config,
        canvas_state: data.canvas_state,
        metadata: data.metadata,
        operations: data.operations?.map((op, index) => ({
          ...op,
          position_x: op.position_x || 0,
          position_y: op.position_y || 0,
          sort_order: op.sort_order || index,
        })),
        connections: data.connections,
      },
    })
    
    if (errors?.length) {
      console.error("[visual-flows] Create workflow errors:", errors)
      return res.status(500).json({ error: "Failed to create flow", details: errors })
    }
    
    res.status(201).json({ flow })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.errors })
    } else {
      res.status(400).json({ error: error.message })
    }
  }
}
