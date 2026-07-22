// #1123 — reconcile the provenance production runs for a set of retail order
// line items against the CURRENT cumulative fulfilled quantity. Shared by the
// fulfillment-created / fulfillment-canceled / order-canceled subscribers so
// the three paths can never drift.
//
// Cumulative quantity = the sum of quantities across all NON-canceled
// fulfillments of the order for a line item. This is the accurate produced/
// shipped yield: a line qty 10 fulfilled 4-then-6 reconciles to 10; if the 6 is
// later canceled it reconciles back down to 4; if everything is canceled (or the
// order is voided) it reconciles to 0 → the run is soft-deleted (no stock
// shipped, so the provenance trail must not claim otherwise).
//
// Only runs THIS system minted as retail provenance (`isOwnedProvenanceRun`) are
// quantity-adjusted or soft-deleted. Real production runs (design work-orders,
// runs that went through the shop) are never touched here.

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import { createProductionRunWorkflow } from "../workflows/production-runs/create-production-run"
import { completeProvenanceRunWorkflow } from "../workflows/production-runs/complete-provenance-run"
import { resolveOwningPartnerId } from "../modules/partner_billing/resolve-retail-partner"
import {
  getProductionRunForLineItem,
  isOwnedProvenanceRun,
  PLAN_UNIQUE_VIOLATION,
} from "./resolve-line-item-production"
import { planLineItemRunAction } from "./plan-fulfillment-production-runs"

type ReconcileInput = {
  orderId: string
  /** Line items to reconcile (this fulfillment's items, or the whole order). */
  lineItemIds: string[]
  /** Order-level cancellation: force cumulative 0 so every owned run is voided. */
  voided?: boolean
}

/**
 * Sum the fulfilled quantity per line item across all non-canceled fulfillments
 * of the order. Fulfillments are reached THROUGH the order (they carry no
 * queryable `order_id` of their own — the relation is a link). Returns a
 * `line_item_id → quantity` map.
 */
function buildCumulativeFulfilledByLine(order: any): Map<string, number> {
  const map = new Map<string, number>()
  for (const f of order?.fulfillments || []) {
    // A canceled fulfillment contributed no shipped stock.
    if (f?.canceled_at) continue
    for (const it of f?.items || []) {
      if (!it?.line_item_id) continue
      const prev = map.get(it.line_item_id) || 0
      map.set(it.line_item_id, prev + (Number(it.quantity) || 0))
    }
  }
  return map
}

export async function reconcileProvenanceRunsForOrderLines(
  container: any,
  input: ReconcileInput,
  logger: Logger
): Promise<void> {
  const { orderId, lineItemIds, voided = false } = input
  if (!lineItemIds.length) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const service: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    // Resolve line_item_id → { product_id, variant_id } + the sales channel for
    // partner attribution (#1121), in one order read.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "sales_channel_id",
        "items.id",
        "items.product_id",
        "items.variant_id",
        "fulfillments.canceled_at",
        "fulfillments.items.line_item_id",
        "fulfillments.items.quantity",
      ],
      filters: { id: orderId },
    })
    const order = (orders || [])[0]
    const itemById = new Map<string, any>(
      (order?.items || []).map((it: any) => [it.id, it])
    )

    const partnerId = await resolveOwningPartnerId(container, {
      orderId,
      salesChannelId: order?.sales_channel_id,
    })

    const cumulativeByLine = voided
      ? new Map<string, number>()
      : buildCumulativeFulfilledByLine(order)

    for (const lineItemId of lineItemIds) {
      try {
        const orderItem = itemById.get(lineItemId)
        const cumulative = voided ? 0 : cumulativeByLine.get(lineItemId) || 0

        if (cumulative <= 0) {
          // Nothing shipped for this line (fulfillment fully canceled or order
          // voided) → soft-delete the run we minted, if any. Never touch a real
          // production run.
          const existing = await getProductionRunForLineItem(query, lineItemId)
          if (isOwnedProvenanceRun(existing)) {
            await service.softDeleteProductionRuns([existing!.id])
            logger.info(
              `[provenance-reconcile] Soft-deleted provenance run ${existing!.id} for line item ${lineItemId} (cumulative fulfilled qty 0)`
            )
          }
          continue
        }

        const plan = await planLineItemRunAction(query, {
          lineItemId,
          productId: orderItem?.product_id,
          variantId: orderItem?.variant_id,
          quantity: cumulative,
        })

        if (plan?.action === "create") {
          await createProductionRunWorkflow(container).run({
            input: {
              design_id: plan.design_id ?? undefined,
              quantity: plan.quantity,
              produced_quantity: plan.quantity,
              product_id: plan.product_id,
              variant_id: plan.variant_id,
              partner_id: partnerId ?? undefined,
              order_id: orderId,
              order_line_item_id: lineItemId,
              status: "completed",
              skip_unified_projection: true,
              metadata: {
                source: "order.fulfillment_created",
                is_custom_design: plan.is_custom_design,
                design_backed: Boolean(plan.design_id),
              },
            },
          })
          logger.info(
            `[provenance-reconcile] Minted ${
              plan.design_id ? "design-backed" : "product-only"
            } production run for line item ${lineItemId} (qty ${plan.quantity}, product ${plan.product_id})`
          )
        } else if (plan?.action === "complete") {
          await completeProvenanceRunWorkflow(container).run({
            input: {
              production_run_id: plan.production_run_id,
              produced_quantity: plan.quantity,
            },
          })
          logger.info(
            `[provenance-reconcile] Completed pre-production run ${plan.production_run_id} for line item ${lineItemId} (qty ${plan.quantity}, shipped from stock)`
          )
        } else {
          // No create/complete → a run already exists that's completed or in
          // production. If it's OUR provenance run and the cumulative fulfilled
          // qty has since grown/shrunk, bump it to match (#1123 aggregate).
          const existing = await getProductionRunForLineItem(query, lineItemId)
          if (
            isOwnedProvenanceRun(existing) &&
            (existing!.produced_quantity ?? 0) !== cumulative
          ) {
            await completeProvenanceRunWorkflow(container).run({
              input: {
                production_run_id: existing!.id,
                produced_quantity: cumulative,
              },
            })
            logger.info(
              `[provenance-reconcile] Adjusted provenance run ${existing!.id} produced_quantity → ${cumulative} for line item ${lineItemId}`
            )
          }
        }
      } catch (e: any) {
        // A concurrent/redelivered event lost the create race against the new
        // unique index — the run exists, so this is a no-op, not a failure.
        if (e?.code === PLAN_UNIQUE_VIOLATION || /unique/i.test(e?.message || "")) {
          logger.info(
            `[provenance-reconcile] Line item ${lineItemId} already has a run (unique guard) — skipping`
          )
          continue
        }
        logger.warn(
          `[provenance-reconcile] Failed to reconcile line item ${lineItemId} for order ${orderId}: ${e?.message || e}`
        )
      }
    }
  } catch (e: any) {
    logger.warn(
      `[provenance-reconcile] Failed to reconcile order ${orderId}: ${e?.message || e}`
    )
  }
}
