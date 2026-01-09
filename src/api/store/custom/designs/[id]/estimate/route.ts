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
