import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import designCustomerLink from "../../../../../../links/design-customer-link";

/**
 * GET /store/custom/designs/:id/estimate
 *
 * Returns a cost estimate for a design based on:
 * - Material costs from linked inventory items (order history → unit_cost fallback)
 * - Component design costs rolled up from bundled sub-designs
 * - Production overhead (derived from admin estimate, similar designs, or 30% default)
 *
 * Query parameters:
 * - inventory_item_ids: Comma-separated list of inventory item IDs to override the default linked items
 *
 * Confidence levels:
 * - "exact"       All materials priced from real order history
 * - "estimated"   Some materials from unit_cost, component costs, or similar-design analysis
 * - "guesstimate" No real pricing data — pure 30% default
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.auth_context?.actor_id;
  const designId = req.params.id;

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer authentication required");
  }

  // Verify the customer owns this design
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: links } = await (query as any).graph({
    entity: designCustomerLink.entryPoint,
    filters: { customer_id: customerId, design_id: designId },
    fields: ["design_id"],
  });

  if (!links || links.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found or not owned by customer");
  }

  // Parse optional inventory_item_ids override
  const inventoryItemIdsParam = req.query.inventory_item_ids as string | undefined;
  const inventoryItemIds = inventoryItemIdsParam
    ? inventoryItemIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : undefined;

  const { result, errors } = await estimateDesignCostWorkflow(req.scope).run({
    input: { design_id: designId, inventory_item_ids: inventoryItemIds },
  });

  if (errors && errors.length > 0) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to estimate design cost");
  }

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
}
