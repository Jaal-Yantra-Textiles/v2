import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { operationRegistry } from "../../../../modules/visual_flows/operations"

/**
 * GET /admin/visual-flows/operations
 * List all available operations for the visual flow builder
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Get operation definitions without the execute function
    const operations = operationRegistry.getDefinitionsForUI()
    
    // Group by category
    const grouped = operations.reduce((acc, op) => {
      if (!acc[op.category]) {
        acc[op.category] = []
      }
      acc[op.category].push(op)
      return acc
    }, {} as Record<string, typeof operations>)
    
    res.json({
      operations,
      grouped,
      categories: ["data", "logic", "communication", "integration", "utility"],
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
