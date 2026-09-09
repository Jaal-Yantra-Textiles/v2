import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { IEventBusModuleService } from "@medusajs/types";
import updateDesignWorkflow from "../../../../../workflows/designs/update-design";
import { createProductFromDesignWorkflow } from "../../../../../workflows/designs/create-product-from-design";
import { requestVariantPriceFanout } from "../../../../../workflows/fx/fanout-variant-prices";
import designCustomerLink from "../../../../../links/design-customer-link";
import {
  readStoreCurrency,
  readStoreId,
  resolveApprovalCurrency,
} from "../../../../../workflows/production-runs/approve-run-output";

/**
 * POST /admin/designs/:id/approve
 *
 * Approves a design: transitions status to "Approved" and creates the
 * real Medusa product/variant from the design.
 *
 * Response:
 * {
 *   design: object,
 *   product_id: string,
 *   variant_id: string,
 * }
 */
export async function POST(
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const designId = req.params.id;
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any;

    // Fetch design with estimated_cost
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["id", "name", "estimated_cost", "cost_currency"],
    });

    if (!designs || designs.length === 0) {
      res.status(404).json({ message: "Design not found" });
      return;
    }

    const design = designs[0];

    /**
     * 🔴 #1900 — a design with no cost must not become a product listed at 0.
     *
     * `estimated_cost || 0` handed `createProductFromDesignWorkflow` a zero,
     * `resolveListedPrice` passed it straight through, and the catalogue got a
     * FREE product with nothing anywhere saying the design had no cost. Two
     * such rows are on prod today. This is worse than the ×100 it replaced: a
     * hundred-fold price is absurd on sight, a 0 looks plausible — the same
     * shape as the estimator's "found nothing = 0" that reached checkout.
     *
     * Refused, not defaulted, and refused BEFORE the status write so a design
     * cannot end up Approved with no product. `> 0` rather than `!= null`,
     * because `Number(null)` is 0 and a real zero is just as unlistable.
     *
     * The sibling door (`approve-run-output`, #1914) already refuses this;
     * they now agree.
     */
    const estimatedCost = Number(design.estimated_cost)
    if (!(Number.isFinite(estimatedCost) && estimatedCost > 0)) {
      res.status(400).json({
        message:
          `Design "${design.name ?? designId}" has no estimated cost, so it cannot be priced. ` +
          `Cost the design first — approving it would list the product at 0.`,
        design_id: designId,
        estimated_cost: design.estimated_cost ?? null,
      });
      return;
    }

    // Look up the customer linked to this design
    const { data: customerLinks } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: { design_id: designId },
      fields: ["customer_id"],
    });

    // `?? undefined`, not `|| ""` (#1920): an empty string put a blank
    // "customer" on the design↔variant link, which reads as present to
    // anything that only checks the field exists. No customer is `undefined`.
    const customerId = customerLinks?.[0]?.customer_id || undefined;

    // Transition design status to Approved
    const { result: updatedDesign, errors: updateErrors } =
      await updateDesignWorkflow(req.scope).run({
        input: {
          id: designId,
          status: "Approved",
        },
      });

    if (updateErrors && updateErrors.length > 0) {
      logger.error(`[Admin] Error updating design status: ${JSON.stringify(updateErrors)}`);
      res.status(500).json({
        message: "Failed to update design status",
        errors: updateErrors,
      });
      return;
    }

    // Create real product/variant from design
    const { result: productResult, errors: productErrors } =
      await createProductFromDesignWorkflow(req.scope).run({
        input: {
          design_id: designId,
          estimated_cost: estimatedCost,
          customer_id: customerId,
          /**
           * 🔴 Was hardcoded `"usd"` on a platform that trades in AUD and INR,
           * so every approved design was listed in a currency nobody sells in
           * (#1805). Resolved from the design's own `cost_currency` — what the
           * work was costed in — with the store default behind it. The rule is
           * shared with the bulk review so the two paths cannot disagree.
           */
          currency_code: resolveApprovalCurrency({
            designCurrency: (design as any).cost_currency,
            storeCurrency: await readStoreCurrency(req.scope),
          }),
        },
      });

    if (productErrors && productErrors.length > 0) {
      logger.error(`[Admin] Error creating product: ${JSON.stringify(productErrors)}`);
      res.status(500).json({
        message: "Failed to create product from design",
        errors: productErrors,
      });
      return;
    }

    /**
     * 🔴 #1900 — materialise the OTHER currencies.
     *
     * Medusa's pricing module emits no `price.created` event, so every path
     * that writes a variant price has to ASK for the fanout. This door never
     * did: `create-product-from-design` writes a ONE-element price array, so
     * every design approved here has been listed in a single currency and
     * reads as unavailable in every other region. The five 2026-08-28 Oshen
     * products carry an AUD price only.
     *
     * The sibling door (`approve-run-output`, #1914) already asks; this is the
     * same call, deliberately identical. Requested rather than run inline: the
     * handler is a subscriber, so the work lands on the WORKER — running this
     * fanout on the request path OOM-killed prod twice on 2026-08-19 (exit
     * 137). It never throws, and currencies the price set already carries are
     * skipped, so a re-approval is a no-op.
     */
    try {
      const storeId = await readStoreId(req.scope)
      if (storeId && productResult?.variant_id) {
        await requestVariantPriceFanout(req.scope, {
          storeId,
          variantIds: [productResult.variant_id],
        })
      }
    } catch (e: any) {
      // The product exists and is priced in its own currency; a missing fanout
      // is a narrower catalogue, not a failed approval.
      logger.warn(
        `[Admin] design ${designId} approved but FX fanout could not be requested: ${e?.message ?? e}`
      )
    }

    // Emit design.approved so partners can be notified
    try {
      const eventBus = req.scope.resolve(Modules.EVENT_BUS) as IEventBusModuleService;
      await eventBus.emit({
        name: "design.approved",
        data: {
          design_id: designId,
          product_id: productResult.product_id,
          variant_id: productResult.variant_id,
        },
      });
    } catch {
      // Non-fatal — approval succeeded, notification is best-effort
    }

    res.status(200).json({
      design: updatedDesign,
      product_id: productResult.product_id,
      variant_id: productResult.variant_id,
    });
  } catch (error) {
    logger.error(`[Admin] Error in design approve: ${error}`, error);
    res.status(500).json({
      message: "Failed to approve design",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
