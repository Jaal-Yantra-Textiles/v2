import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import designCustomerLink from "../../../../../../links/design-customer-link";
import designLineItemLink from "../../../../../../links/design-line-item-link";
import { DESIGN_MODULE } from "../../../../../../modules/designs";

/**
 * POST /store/custom/designs/:id/checkout
 *
 * Adds a custom line item to the cart for a design (no product created yet).
 * Admin approval (POST /admin/designs/:id/approve) creates the real product/variant.
 *
 * Request body:
 * {
 *   cart_id: string,               // Required: cart to add the item to
 *   inventory_item_ids?: string[],  // Materials to include in cost estimate
 *   currency_code?: string,          // Currency for pricing (default: "usd")
 * }
 *
 * Response:
 * {
 *   line_item_id: string,
 *   price: number,
 *   cost_estimate: { material_cost, production_cost, total_estimated, confidence, breakdown },
 * }
 */
export async function POST(
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

    const body = req.body as {
      cart_id?: string;
      inventory_item_ids?: string[];
      currency_code?: string;
    };

    if (!body.cart_id) {
      res.status(400).json({ message: "cart_id is required" });
      return;
    }

    const cartId = body.cart_id;

    // Verify customer owns this design
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any;
    const { data: links } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: {
        customer_id: customerId,
        design_id: designId,
      },
      fields: ["design_id"],
    });

    if (!links || links.length === 0) {
      res.status(404).json({
        message: "Design not found or not owned by customer",
      });
      return;
    }

    // Fetch design name for line item title
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["name"],
    });

    const designName = designs?.[0]?.name || "Custom Design";

    // Estimate cost
    const { result: costEstimate, errors: costErrors } =
      await estimateDesignCostWorkflow(req.scope).run({
        input: {
          design_id: designId,
          inventory_item_ids: body.inventory_item_ids,
        },
      });

    if (costErrors && costErrors.length > 0) {
      console.error("[Store] Error estimating cost:", costErrors);
      res.status(500).json({
        message: "Failed to estimate design cost",
        errors: costErrors,
      });
      return;
    }

    // Add custom line item to the cart
    const cartService = req.scope.resolve(Modules.CART) as any;
    const lineItems = await cartService.addLineItems(cartId, [
      {
        title: designName,
        unit_price: Math.round(costEstimate.total_estimated * 100),
        is_custom_price: true,
        quantity: 1,
        metadata: { design_id: designId },
      },
    ]);

    const lineItem = lineItems?.[0];
    if (!lineItem) {
      res.status(500).json({ message: "Failed to add line item to cart" });
      return;
    }

    // Register the design → line item module link for reliable querying
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
  } catch (error) {
    console.error("[Store] Error in design checkout:", error);
    res.status(500).json({
      message: "Failed to process design checkout",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
