import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import designCustomerLink from "../../../../../../links/design-customer-link";
import designLineItemLink from "../../../../../../links/design-line-item-link";
import { DESIGN_MODULE } from "../../../../../../modules/designs";

/**
 * POST /store/custom/designs/:id/checkout
 *
 * Adds a custom line item to the cart priced at the design's cost estimate.
 * Admin approval (POST /admin/designs/:id/approve) later creates the real product/variant.
 *
 * Request body:
 * {
 *   cart_id: string               Required — cart to add the item to
 *   inventory_item_ids?: string[] Optional — override which inventory items to price
 *   currency_code?: string        Optional — defaults to "usd"
 * }
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.auth_context?.actor_id;
  const designId = req.params.id;

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer authentication required");
  }

  const body = req.body as {
    cart_id?: string;
    inventory_item_ids?: string[];
    currency_code?: string;
  };

  if (!body.cart_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "cart_id is required");
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any;

  // Verify the customer owns this design
  const { data: links } = await query.graph({
    entity: designCustomerLink.entryPoint,
    filters: { customer_id: customerId, design_id: designId },
    fields: ["design_id"],
  });

  if (!links || links.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found or not owned by customer");
  }

  // Fetch design name for the line item title
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["name"],
  });
  const designName = designs?.[0]?.name || "Custom Design";

  // Run cost estimation (includes component design costs)
  const { result: costEstimate, errors: costErrors } =
    await estimateDesignCostWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_item_ids: body.inventory_item_ids,
      },
    });

  if (costErrors && costErrors.length > 0) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to estimate design cost");
  }

  // Prices in Medusa carts are stored in the smallest currency unit (cents)
  const unitPriceCents = Math.round(costEstimate.total_estimated * 100);

  const cartService = req.scope.resolve(Modules.CART) as any;
  const lineItems = await cartService.addLineItems(body.cart_id, [
    {
      title: designName,
      unit_price: unitPriceCents,
      is_custom_price: true,
      quantity: 1,
      metadata: {
        design_id: designId,
        cost_confidence: costEstimate.confidence,
      },
    },
  ]);

  const lineItem = lineItems?.[0];
  if (!lineItem) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to add line item to cart");
  }

  // Create design → line item link for admin tracking
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any;
  await remoteLink.create({
    [DESIGN_MODULE]: { design_id: designId },
    [Modules.CART]: { line_item_id: lineItem.id },
  });

  res.status(200).json({
    line_item_id: lineItem.id,
    price: costEstimate.total_estimated,
    cost_estimate: {
      material_cost: costEstimate.material_cost,
      production_cost: costEstimate.production_cost,
      total_estimated: costEstimate.total_estimated,
      confidence: costEstimate.confidence,
      breakdown: costEstimate.breakdown,
    },
  });
}
