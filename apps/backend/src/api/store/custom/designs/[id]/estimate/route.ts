import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { estimateDesignCostWorkflow } from "../../../../../../workflows/designs/estimate-design-cost";
import designCustomerLink from "../../../../../../links/design-customer-link";
import {
  fetchExchangeRate,
  applyRate,
} from "../../../../../../workflows/designs/create-draft-order-from-designs";
import { resolveStorefrontCurrency } from "../../../../../../lib/resolve-store-currency";

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
 * - currency_code: Target currency for the estimate (e.g. "eur"). If provided, costs are
 *   converted from the store default currency. If omitted, costs are in the store default.
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

  /**
   * 🔴 The estimate is denominated by the STOREFRONT, not by whichever store
   * row came back first.
   *
   * This read used to be `entity: "store", filters: {}` → `[0]` → literal
   * `"eur"`. The deployment runs 14 stores; row 0 is the platform store (EUR)
   * while most partner storefronts are INR, so every partner storefront's
   * estimate was labelled EUR — and the checkout route then converted that same
   * figure EUR→INR, inflating the price by the exchange rate. The sibling route
   * defaulted to `"inr"` instead, so the two disagreed by ~100x on the same
   * lookup.
   *
   * The publishable key names the tenant. When it cannot, we refuse: an
   * estimate shown under the wrong currency symbol is worse than no estimate.
   */
  const storeCurrency = await resolveStorefrontCurrency(
    req.scope,
    req.publishable_key_context
  );

  if (!storeCurrency) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Could not determine this storefront's currency, so this design cannot be priced. Please contact us for a quote."
    );
  }

  // Optional: convert to the requested currency
  const targetCurrency = ((req.query.currency_code as string) || "").toLowerCase() || storeCurrency;
  let materialCost = result.material_cost;
  let productionCost = result.production_cost;
  let totalEstimated = result.total_estimated;

  if (targetCurrency !== storeCurrency) {
    const rate = await fetchExchangeRate(storeCurrency, targetCurrency);
    materialCost = applyRate(materialCost, rate);
    productionCost = applyRate(productionCost, rate);
    // A missing estimate stays missing in every currency. Converting null would
    // produce a very confident 0. #1564
    totalEstimated =
      totalEstimated == null ? null : applyRate(totalEstimated, rate);
  }

  res.status(200).json({
    costs: {
      material_cost: materialCost,
      production_cost: productionCost,
      total_estimated: totalEstimated,
      confidence: result.confidence,
    },
    currency_code: targetCurrency,
    breakdown: result.breakdown,
    similar_designs: result.similar_designs,
  });
}
