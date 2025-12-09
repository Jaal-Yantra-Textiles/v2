import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import VisualFlowService from "../../../../modules/visual_flows/service"
import { z } from "zod"
import { updateVisualFlowWorkflow, deleteVisualFlowWorkflow } from "../../../../workflows/visual-flows"

const operationSchema = z.object({
  id: z.string().optional(),
  operation_key: z.string(),
  operation_type: z.string(),
  name: z.string().optional().nullable(),
  options: z.record(z.any()).optional(),
  position_x: z.number(),
  position_y: z.number(),
  sort_order: z.number(),
})

const connectionSchema = z.object({
  id: z.string().optional(),
  source_id: z.string(),
  source_handle: z.string().optional(),
  target_id: z.string(),
  target_handle: z.string().optional(),
  connection_type: z.enum(["success", "failure", "default"]).optional(),
  condition: z.record(z.any()).optional().nullable(),
  label: z.string().optional().nullable(),
  style: z.record(z.any()).optional().nullable(),
})

const updateFlowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  icon: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  trigger_type: z.enum(["event", "schedule", "webhook", "manual", "another_flow"]).optional(),
  trigger_config: z.record(z.any()).optional(),
  canvas_state: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  operations: z.array(operationSchema).optional(),
  connections: z.array(connectionSchema).optional(),
})

/**
 * GET /admin/visual-flows/:id
 * Get a single visual flow with operations and connections
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const flow = await service.getFlowWithDetails(id)
    
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" })
    }
    
    res.json({ flow })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}

/**
 * PUT /admin/visual-flows/:id
 * Update a visual flow with operations and connections using workflow
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    
    const data = updateFlowSchema.parse(req.body)
    
    // Use workflow for transactional update with rollback support
    const { result: flow, errors } = await updateVisualFlowWorkflow(req.scope).run({
      input: {
        id,
        name: data.name,
        description: data.description,
        status: data.status,
        icon: data.icon,
        color: data.color,
        trigger_type: data.trigger_type,
        trigger_config: data.trigger_config,
        canvas_state: data.canvas_state,
        metadata: data.metadata,
        operations: data.operations,
        connections: data.connections,
      },
    })
    
    if (errors?.length) {
      console.error("[visual-flows] Update workflow errors:", errors)
      return res.status(500).json({ error: "Failed to update flow", details: errors })
    }
    
    res.json({ flow })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.errors })
    } else {
      res.status(400).json({ error: error.message })
    }
  }
}

/**
 * DELETE /admin/visual-flows/:id
 * Delete a visual flow using workflow
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    
    // Use workflow for transactional delete with rollback support
    const { result, errors } = await deleteVisualFlowWorkflow(req.scope).run({
      input: { flowId: id },
    })
    
    if (errors?.length) {
      console.error("[visual-flows] Delete workflow errors:", errors)
      return res.status(500).json({ error: "Failed to delete flow", details: errors })
    }
    
    res.status(200).json({ success: true, id })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
