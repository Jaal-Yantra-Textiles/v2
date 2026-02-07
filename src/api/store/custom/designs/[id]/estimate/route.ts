/**
 * @file Store API route for estimating design costs
 * @description Provides endpoints for calculating cost estimates for custom designs in the JYT Commerce platform
 * @module API/Store/CustomDesigns
 */

/**
 * @typedef {Object} DesignEstimateRequest
 * @property {string} id - The ID of the design to estimate
 * @property {string} [inventory_item_ids] - Comma-separated list of inventory item IDs to use for estimation
 */

/**
 * @typedef {Object} MaterialBreakdown
 * @property {string} name - The name of the material
 * @property {number} cost - The cost of the material
 * @property {number} quantity - The quantity of the material
 */

/**
 * @typedef {Object} SimilarDesign
 * @property {string} id - The ID of the similar design
 * @property {string} name - The name of the similar design
 * @property {number} estimated_cost - The estimated cost of the similar design
 */

/**
 * @typedef {Object} DesignEstimateResponse
 * @property {Object} costs - The cost estimates for the design
 * @property {number} costs.material_cost - The estimated material cost
 * @property {number} costs.production_cost - The estimated production cost
 * @property {number} costs.total_estimated - The total estimated cost
 * @property {"exact" | "estimated" | "guesstimate"} costs.confidence - The confidence level of the estimate
 * @property {Object} breakdown - The breakdown of the cost estimate
 * @property {MaterialBreakdown[]} breakdown.materials - The breakdown of material costs
 * @property {number} breakdown.production_percent - The percentage used for production cost estimation
 * @property {SimilarDesign[]} [similar_designs] - List of similar designs with their estimated costs
 */

/**
 * Get cost estimate for a custom design
 * @route GET /store/custom/designs/:id/estimate
 * @group Custom Designs - Operations related to custom designs
 * @param {string} id.path.required - The ID of the design to estimate
 * @param {string} [inventory_item_ids] - Comma-separated list of inventory item IDs to use for estimation
 * @returns {DesignEstimateResponse} 200 - The cost estimate for the design
 * @throws {MedusaError} 400 - Design ID is required
 * @throws {MedusaError} 401 - Customer authentication required
 * @throws {MedusaError} 404 - Design not found or not owned by customer
 * @throws {MedusaError} 500 - Failed to estimate design cost
 *
 * @example request
 * GET /store/custom/designs/design_123456789/estimate?inventory_item_ids=item_123,item_456
 *
 * @example response 200
 * {
 *   "costs": {
 *     "material_cost": 45.99,
 *     "production_cost": 20.50,
 *     "total_estimated": 66.49,
 *     "confidence": "estimated"
 *   },
 *   "breakdown": {
 *     "materials": [
 *       {
 *         "name": "Cotton Fabric",
 *         "cost": 25.99,
 *         "quantity": 2
 *       },
 *       {
 *         "name": "Metal Buttons",
 *         "cost": 5.00,
 *         "quantity": 10
 *       }
 *     ],
 *     "production_percent": 0.3
 *   },
 *   "similar_designs": [
 *     {
 *       "id": "design_987654321",
 *       "name": "Summer Dress",
 *       "estimated_cost": 65.00
 *     }
 *   ]
 * }
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import designCustomerLink from "../../../../../../links/design-customer-link";

/**
 * GET /store/custom/designs/:id/estimate
 *
 * Returns a cost estimate for a design based on:
 * - Material costs from inventory order history
 * - Production costs (from design.estimated_cost or 30% default)
 * - Similar designs as reference
 *
 * Query parameters:
 * - inventory_item_ids: Comma-separated list of inventory item IDs to use for estimation
 *                       (optional - defaults to design's linked inventory items)
 *
 * Response:
 * {
 *   costs: {
 *     material_cost: number,
 *     production_cost: number,
 *     total_estimated: number,
 *     confidence: "exact" | "estimated" | "guesstimate"
 *   },
 *   breakdown: {
 *     materials: Array<{ name: string, cost: number, quantity: number }>,
 *     production_percent: number
 *   },
 *   similar_designs?: Array<{ id: string, name: string, estimated_cost: number }>
 * }
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const customerId = req.auth_context?.actor_id;
    const designId = req.params.id;

    if (!customerId) {
      res.status(401).json({ message: "Customer authentication required" });
      return;
    }

    if (!designId) {
      res.status(400).json({ message: "Design ID is required" });
      return;
    }

    // Verify customer owns this design
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: links } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: {
        customer_id: customerId,
        design_id: designId,
      },
      fields: ["design_id"],
    });

    if (!links || links.length === 0) {
      res.status(404).json({ message: "Design not found or not owned by customer" });
      return;
    }

    // Parse inventory_item_ids from query string if provided
    const inventoryItemIdsParam = req.query.inventory_item_ids as string | undefined;
    const inventoryItemIds = inventoryItemIdsParam
      ? inventoryItemIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;

    // Run the cost estimation workflow
    const { result, errors } = await estimateDesignCostWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_item_ids: inventoryItemIds,
      },
    });

    if (errors && errors.length > 0) {
      console.error("[Store] Error estimating design cost:", errors);
      res.status(500).json({
        message: "Failed to estimate design cost",
        errors,
      });
      return;
    }

    // Format response
    res.status(200).json({
      costs: {
        material_cost: result.material_cost,
        production_cost: result.production_cost,
        total_estimated: result.total_estimated,
        confidence: result.confidence,
      },
      breakdown: result.breakdown,
      similar_designs: result.similar_designs,
    });
  } catch (error) {
    console.error("[Store] Error in design cost estimation:", error);
    res.status(500).json({
      message: "Failed to estimate design cost",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
