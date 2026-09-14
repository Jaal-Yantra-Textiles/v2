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
import { resolveApprovalCurrency } from "../../../../../workflows/production-runs/approve-run-output";
import { approvalCurrencyWasAssumed } from "../../../../../workflows/production-runs/approval-pricing";
import {
  currencyIsSellable,
  readHouseStore,
} from "../../../../../workflows/production-runs/house-store";

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
     * 🔑 #2030 item 3 — the operator's size, when the design cannot decide.
     *
     * A design stating S and M is genuinely ambiguous, so the minter abstains
     * and produces a variant with no size — which is how order 89 came to be
     * bound to a sizeless placeholder someone later relabelled "Small". The
     * admin now ASKS which size this product is for and sends the answer here.
     *
     * Optional, so every existing caller is unchanged. A blank string is not an
     * answer: it falls through to the design's own size_sets rather than
     * minting `CUSTOM-<id>-`.
     */
    const rawSizeLabel = (req.body as { size_label?: unknown } | undefined)
      ?.size_label;
    const sizeLabel =
      typeof rawSizeLabel === "string" && rawSizeLabel.trim()
        ? rawSizeLabel.trim()
        : undefined;

    /**
     * 🔑 #2059 — the catalogue this product goes into, when the admin wants to
     * say.
     *
     * Optional, and read raw like `size_label` above (this route has no
     * validator middleware). Blank is not an answer and falls through.
     *
     * Precedence is deliberate and worth stating: an explicit channel WINS.
     * A partner-owned design still auto-routes to the partner's own catalogue
     * whenever nothing explicit is passed, which is the common case — this
     * exists so an admin can override that for the deliberate exceptions, not
     * so they have to think about it every time.
     */
    const rawSalesChannelId = (
      req.body as { sales_channel_id?: unknown } | undefined
    )?.sales_channel_id;
    const salesChannelId =
      typeof rawSalesChannelId === "string" && rawSalesChannelId.trim()
        ? rawSalesChannelId.trim()
        : undefined;

    /**
     * Refuse an unknown channel HERE, before the status write.
     *
     * Handed straight to the minter, a typo'd id surfaces as a product-creation
     * failure several layers down, after the design has already been marked
     * Approved — the same "approved with no product" split this route's cost
     * guard below exists to prevent.
     */
    if (salesChannelId) {
      const { data: channels } = await query.graph({
        entity: "sales_channels",
        filters: { id: salesChannelId },
        fields: ["id"],
      });
      if (!channels?.length) {
        res.status(400).json({
          message: `Sales channel ${salesChannelId} does not exist.`,
          design_id: designId,
          sales_channel_id: salesChannelId,
        });
        return;
      }
    }

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

    const houseStore = await readHouseStore(req.scope);
    const approvalCurrency = resolveApprovalCurrency({
      designCurrency: (design as any).cost_currency,
    });
    if (!currencyIsSellable(approvalCurrency, houseStore)) {
      /**
       * A GUARD, never an override — re-denominating a cost to whatever the
       * store prefers is the #1979 defect itself. This only says the price is
       * not sellable here, so the condition stops being silent.
       */
      logger.warn(
        `[Admin] Design ${designId} is priced in ${approvalCurrency}, which the house store ` +
          `does not sell in (enabled: ${houseStore?.currencies.join(", ") || "unknown"}). ` +
          `The price is correct but unsellable until ${approvalCurrency} is enabled.`
      );
    }
    if (approvalCurrencyWasAssumed((design as any).cost_currency)) {
      /**
       * A GUESS, and the common case — 42 of 43 costed designs on prod had no
       * `cost_currency` when #1979 was found. The approval still proceeds
       * (refusing would block every approval on the platform), but the
       * assumption is logged rather than living only in a docblock.
       */
      logger.warn(
        `[Admin] Design ${designId} has no cost_currency; assuming ${approvalCurrency}. ` +
          `If it was not costed in ${approvalCurrency}, the listed price is wrong.`
      );
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
           * work was costed in — with INR behind it. The rule is shared with
           * the bulk review so the two paths cannot disagree.
           *
           * 🔴 The store default used to sit between the two (#1979). This
           * store's default is EUR, so an INR-costed design minted in euros
           * and fanned out to ~110x its cost. A cost is denominated by how it
           * was COMPUTED, not by where the garment is sold.
           */
          currency_code: approvalCurrency,
          size_label: sizeLabel,
          /**
           * Undefined when the admin named none — the minter then routes a
           * partner-owned design to its partner's catalogue, and everything
           * else to the house store. It never falls back to `stores[0]`. #2059
           */
          sales_channel_id: salesChannelId,
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
      // Already read above for the sellability guard — one query, not two.
      const storeId = houseStore?.id ?? null
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
