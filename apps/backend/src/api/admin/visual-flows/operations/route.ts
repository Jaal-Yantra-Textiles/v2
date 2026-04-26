/**
 * Visual Flow Operations API
 *
 * This API provides access to the visual flow builder operations registry.
 * Operations are the building blocks used to create visual workflows.
 *
 * Example Usage:
 *
 * 1. Get all operations:
 *    GET /admin/visual-flows/operations
 *    Response: { operations: Operation[], grouped: Record<string, Operation[]>, categories: string[] }
 *
 * 2. Filter operations by category:
 *    GET /admin/visual-flows/operations?category=data
 *    Response: { operations: Operation[], grouped: Record<string, Operation[]>, categories: string[] }
 *
 * 3. Search operations by name:
 *    GET /admin/visual-flows/operations?search=transform
 *    Response: { operations: Operation[], grouped: Record<string, Operation[]>, categories: string[] }
 *
 * Response Structure:
 * - operations: Array of all operations with their metadata (without execute function)
 * - grouped: Operations grouped by their category
 * - categories: Array of all available categories
 *
 * Operation Structure:
 * {
 *   id: string,
 *   name: string,
 *   description: string,
 *   category: string,
 *   inputs: {
 *     [key: string]: {
 *       type: string,
 *       required: boolean,
 *       description: string
 *     }
 *   },
 *   outputs: {
 *     [key: string]: {
 *       type: string,
 *       description: string
 *     }
 *   }
 * }
 */
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
