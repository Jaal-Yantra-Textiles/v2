import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import VisualFlowService from "../../../../modules/visual_flows/service"
import { executeVisualFlowWorkflow } from "../../../../workflows/visual-flows"

/**
 * POST /webhooks/flows/:id
 * Webhook trigger for visual flows
 * 
 * This endpoint allows external services to trigger flows via HTTP webhook.
 * The flow must have trigger_type = "webhook" and status = "active"
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    // Get the flow
    const flow = await service.retrieveVisualFlow(id)
    
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" })
    }
    
    // Verify it's a webhook trigger
    if (flow.trigger_type !== "webhook") {
      return res.status(400).json({ 
        error: "This flow is not configured for webhook triggers" 
      })
    }
    
    // Verify it's active
    if (flow.status !== "active") {
      return res.status(400).json({ 
        error: "This flow is not active" 
      })
    }
    
    // Optional: Verify webhook secret if configured
    const triggerConfig = flow.trigger_config as any
    if (triggerConfig?.secret) {
      const providedSecret = req.headers["x-webhook-secret"] || req.query.secret
      if (providedSecret !== triggerConfig.secret) {
        return res.status(401).json({ error: "Invalid webhook secret" })
      }
    }
    
    // Build trigger data from request
    const triggerData = {
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([key]) => 
          !key.startsWith("x-medusa") && key !== "authorization"
        )
      ),
      query: req.query,
      body: req.body,
      method: req.method,
      ip: req.ip,
    }
    
    // Execute asynchronously if configured, otherwise wait
    if (triggerConfig?.async) {
      // Fire and forget - start workflow without waiting
      executeVisualFlowWorkflow(req.scope).run({
        input: {
          flowId: id,
          triggerData,
          triggeredBy: "webhook",
          metadata: { webhook_ip: req.ip },
        },
      }).catch(err => {
        console.error(`[Visual Flow Webhook] Error executing flow ${id}:`, err)
      })
      
      res.status(202).json({ 
        message: "Flow execution started",
        flow_id: id,
      })
    } else {
      // Wait for completion using workflow
      const { result, errors } = await executeVisualFlowWorkflow(req.scope).run({
        input: {
          flowId: id,
          triggerData,
          triggeredBy: "webhook",
          metadata: { webhook_ip: req.ip },
        },
      })
      
      if (errors?.length) {
        console.error("[Visual Flow Webhook] Workflow errors:", errors)
        return res.status(500).json({ 
          error: "Flow execution failed", 
          details: errors 
        })
      }
      
      res.json({
        execution_id: result.executionId,
        status: result.status,
        error: result.error,
      })
    }
  } catch (error: any) {
    console.error("[Visual Flow Webhook] Error:", error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * GET /webhooks/flows/:id
 * Health check for webhook endpoint
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)
    
    const flow = await service.retrieveVisualFlow(id)
    
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" })
    }
    
    res.json({
      flow_id: id,
      name: flow.name,
      trigger_type: flow.trigger_type,
      status: flow.status,
      webhook_enabled: flow.trigger_type === "webhook" && flow.status === "active",
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
