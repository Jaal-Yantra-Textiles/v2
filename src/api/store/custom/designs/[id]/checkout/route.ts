/**
 * @file Store API route for design checkout
 * @description Provides endpoint for converting custom designs into purchasable products
 * @module API/Store/Designs
 */

/**
 * @typedef {Object} DesignCheckoutRequest
 * @property {string[]} [inventory_item_ids] - Array of material IDs to include in cost estimation
 * @property {string} [currency_code="usd"] - Currency code for pricing (default: USD)
 */

/**
 * @typedef {Object} CostEstimate
 * @property {number} material_cost - Estimated cost of materials
 * @property {number} production_cost - Estimated production cost
 * @property {number} total_estimated - Total estimated cost
 * @property {number} confidence - Confidence score (0-1) of the estimate
 * @property {Object} breakdown - Detailed cost breakdown by component
 */

/**
 * @typedef {Object} DesignCheckoutResponse
 * @property {string} product_id - ID of the created product
 * @property {string} variant_id - ID of the created variant (to add to cart)
 * @property {number} price - Final price of the product
 * @property {boolean} is_new_product - Whether a new product was created
 * @property {CostEstimate} cost_estimate - Detailed cost estimation
 */

/**
 * Convert a custom design to a purchasable product
 * @route POST /store/custom/designs/:id/checkout
 * @group Design - Operations related to custom designs
 * @param {string} id.path.required - Design ID to checkout
 * @param {DesignCheckoutRequest} request.body.required - Checkout configuration
 * @returns {DesignCheckoutResponse} 200 - Product and variant information
 * @throws {MedusaError} 400 - Missing design ID
 * @throws {MedusaError} 401 - Customer authentication required
 * @throws {MedusaError} 404 - Design not found or not owned by customer
 * @throws {MedusaError} 500 - Failed to estimate cost or create product
 *
 * @example request
 * POST /store/custom/designs/design_123456789/checkout
 * {
 *   "inventory_item_ids": ["mat_wood_123", "mat_fabric_456"],
 *   "currency_code": "usd"
 * }
 *
 * @example response 200
 * {
 *   "product_id": "prod_987654321",
 *   "variant_id": "variant_123456789",
 *   "price": 4999,
 *   "is_new_product": true,
 *   "cost_estimate": {
 *     "material_cost": 1500,
 *     "production_cost": 3000,
 *     "total_estimated": 4500,
 *     "confidence": 0.95,
 *     "breakdown": {
 *       "wood": 800,
 *       "fabric": 700,
 *       "labor": 2500,
 *       "overhead": 500
 *     }
 *   }
 * }
 *
 * @example response 401
 * {
 *   "message": "Customer authentication required"
 * }
 *
 * @example response 404
 * {
 *   "message": "Design not found or not owned by customer"
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to estimate design cost",
 *   "errors": ["Material not found: mat_wood_123"]
 * }
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import { createProductFromDesignWorkflow } from "../../../../../../workflows/designs/create-product-from-design";
import designCustomerLink from "../../../../../../links/design-customer-link";

/**
 * POST /store/custom/designs/:id/checkout
 *
 * Creates a purchasable product/variant from a design.
 *
 * This is the main endpoint for the "design to cart" flow:
 * 1. Validates customer owns the design
 * 2. Estimates cost (or uses provided cost)
 * 3. Creates product/variant linked to design
 *
 * The frontend should then use the returned variant_id to add to cart
 * via the standard Medusa cart API.
 *
 * Request body:
 * {
 *   inventory_item_ids?: string[],  // Materials to include in cost estimate
 *   currency_code?: string,          // Currency for pricing (default: "usd")
 * }
 *
 * Response:
 * {
 *   product_id: string,
 *   variant_id: string,
 *   price: number,
 *   is_new_product: boolean,
 *   cost_estimate: {...},
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
      inventory_item_ids?: string[];
      currency_code?: string;
    };

    const currencyCode = body.currency_code || "usd";

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

    // Step 1: Estimate cost
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

    // Step 2: Create product/variant from design
    const { result: productResult, errors: productErrors } =
      await createProductFromDesignWorkflow(req.scope).run({
        input: {
          design_id: designId,
          estimated_cost: costEstimate.total_estimated,
          customer_id: customerId,
          currency_code: currencyCode,
        },
      });

    if (productErrors && productErrors.length > 0) {
      console.error("[Store] Error creating product:", productErrors);
      res.status(500).json({
        message: "Failed to create product from design",
        errors: productErrors,
      });
      return;
    }

    // Return the product/variant info - frontend will handle adding to cart
    res.status(200).json({
      product_id: productResult.product_id,
      variant_id: productResult.variant_id,
      price: productResult.price,
      is_new_product: productResult.is_new_product,
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
