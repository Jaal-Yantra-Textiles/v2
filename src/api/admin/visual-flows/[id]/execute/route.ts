import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { executeVisualFlowWorkflow } from "../../../../../workflows/visual-flows"

const executeSchema = z.object({
  trigger_data: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
})

/**
 * POST /admin/visual-flows/:id/execute
 * Manually execute a visual flow using workflow
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const data = executeSchema.parse(req.body)
    
    // Get user info for accountability
    const userId = (req as any).auth_context?.actor_id
    
    // Execute the flow using workflow
    const { result, errors } = await executeVisualFlowWorkflow(req.scope).run({
      input: {
        flowId: id,
        triggerData: data.trigger_data || {},
        triggeredBy: userId || "manual",
        metadata: data.metadata,
      },
    })
    
    if (errors?.length) {
      console.error("[visual-flows] Execute workflow errors:", errors)
      return res.status(500).json({ 
        error: "Failed to execute flow", 
        details: errors 
      })
    }
    
    res.json({
      execution_id: result.executionId,
      status: result.status,
      data_chain: result.dataChain,
      error: result.error,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.errors })
    } else {
      res.status(400).json({ error: error.message })
    }
  }
}
