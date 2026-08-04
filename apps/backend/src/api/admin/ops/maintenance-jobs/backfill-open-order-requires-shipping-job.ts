import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1195 — backfill `requires_shipping` on open orders and their fulfillments.
 *
 * THE BUG
 * -------
 * `requires_shipping` on a line item is DERIVED, not asked for:
 * `hasShippingProfile || someInventoryRequiresShipping`
 * (core-flows `prepare-line-item-data.js:23-29`), and `create-fulfillment.js`
 * copies the item flag onto the fulfillment. Most of our catalogue has no
 * shipping profile and sells variants with `manage_inventory: false`, so both
 * operands are false and every such fulfillment is stamped
 * `requires_shipping: false`.
 *
 * The dashboard then hides the shipment action on that flag alone — an
 * undocumented term; the only restriction the Medusa user guide documents is
 * the pickup-option one. We relaxed our own partner UI gate, but the admin core
 * gate lives inside the shipped `@medusajs/dashboard` bundle
 * (`order-detail-*.mjs`) and cannot be patched from here. Repairing the DATA is
 * what fixes admin — and it also stops the wrong value propagating into any
 * future fulfillment created from these orders.
 *
 * WHAT IT DOES
 * ------------
 * For every OPEN order (status not canceled/archived/completed, not
 * `canceled_at`), finds fulfillments that
 *   - are not canceled, and
 *   - went out on a NON-pickup shipping option (or no option at all — every
 *     fulfillment we create is `manual_manual` through the shipping
 *     side-channel), and
 *   - are stamped `requires_shipping: false`
 * and sets them to `true`, along with the order line items those fulfillments
 * cover. A pickup fulfillment is left alone — that is the one real restriction,
 * and flipping it would surface "Mark as shipped" on an order the customer
 * collects in person.
 *
 * Dry-run (default) previews every before→after without writing; apply is
 * idempotent (a second run finds nothing left to flip).
 *
 * NOTE: `requires_shipping` is absent from the public `UpdateFulfillmentDTO`,
 * but `updateFulfillment_` spreads `data` straight into
 * `fulfillmentService_.update([{ id, ...data }])`, so the column is writable.
 * The cast at the call site is deliberate and load-bearing.
 */

/** Hard cap on orders scanned in one call. */
export const MAX_OPEN_ORDER_SCAN = 5000

/** Order statuses that are NOT "open" for the purposes of this backfill. */
export const CLOSED_ORDER_STATUSES = ["canceled", "archived", "completed"]

const paramsSchema = z.object({
  /** Restrict to a single order. */
  order_id: z.string().min(1).optional(),
  /** Max orders to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_OPEN_ORDER_SCAN)
    .optional()
    .default(1000),
})

/**
 * PURE: is this fulfillment a pickup one? Mirrors the dashboard's own
 * derivation (`shipping_option.service_zone.fulfillment_set.type === "pickup"`).
 * A fulfillment with no shipping option is NOT treated as pickup — our manual
 * side-channel fulfillments are shipped goods. Exported for unit testing.
 */
export function isPickupFulfillment(fulfillment: any): boolean {
  return (
    fulfillment?.shipping_option?.service_zone?.fulfillment_set?.type ===
    "pickup"
  )
}

/**
 * PURE: should this fulfillment's `requires_shipping` be flipped to true?
 * Only when it is currently false, the fulfillment is live (not canceled), and
 * it is not a pickup. Exported for unit testing.
 */
export function needsRequiresShippingRepair(fulfillment: any): boolean {
  if (!fulfillment) return false
  if (fulfillment.canceled_at) return false
  if (isPickupFulfillment(fulfillment)) return false
  return fulfillment.requires_shipping === false
}

/**
 * PURE: the line item ids a fulfillment covers. Fulfillment items carry
 * `line_item_id`; anything missing one (older rows) is skipped rather than
 * guessed at. Exported for unit testing.
 */
export function fulfillmentLineItemIds(fulfillment: any): string[] {
  const ids = (fulfillment?.items ?? [])
    .map((i: any) => i?.line_item_id)
    .filter((id: any): id is string => typeof id === "string" && !!id)
  return Array.from(new Set(ids))
}

/**
 * PURE: given one open order, decide every repair it needs. Returns the
 * fulfillment ids to flip and the line item ids to flip (only items actually
 * covered by a repairable fulfillment AND currently stamped false).
 * Exported for unit testing.
 */
export function planOrderRepair(order: any): {
  fulfillmentIds: string[]
  lineItemIds: string[]
} {
  const fulfillmentIds: string[] = []
  const coveredLineItemIds = new Set<string>()

  for (const f of order?.fulfillments ?? []) {
    if (!needsRequiresShippingRepair(f)) continue
    fulfillmentIds.push(f.id)
    for (const lineItemId of fulfillmentLineItemIds(f)) {
      coveredLineItemIds.add(lineItemId)
    }
  }

  const lineItemIds = (order?.items ?? [])
    .filter(
      (item: any) =>
        coveredLineItemIds.has(item?.id) && item?.requires_shipping === false
    )
    .map((item: any) => item.id)

  return { fulfillmentIds, lineItemIds }
}

/** PURE: the operator-facing summary line. Exported for unit testing. */
export function summarizeRequiresShippingBackfill(
  dryRun: boolean,
  scannedOrders: number,
  fulfillmentCount: number,
  lineItemCount: number
): string {
  if (fulfillmentCount === 0 && lineItemCount === 0) {
    return `No changes — scanned ${scannedOrders} open order(s), every live non-pickup fulfillment already requires shipping`
  }
  return `${dryRun ? "Would set" : "Set"} requires_shipping=true on ${fulfillmentCount} fulfillment(s) and ${lineItemCount} line item(s) across ${scannedOrders} scanned open order(s)`
}

export const backfillOpenOrderRequiresShippingJob: MaintenanceJob = {
  id: "backfill-open-order-requires-shipping",
  label: "Backfill requires_shipping on open orders (#1195)",
  description:
    "Repair open orders whose fulfillments were stamped requires_shipping=false by Medusa's derivation (no shipping profile + manage_inventory:false), which hides the 'Mark as shipped' action in the admin dashboard. Sets requires_shipping=true on every live NON-pickup fulfillment of an open order and on the line items it covers. Pickup fulfillments are left untouched. Dry-run previews the before/after; apply is idempotent.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Restrict the run to a single order id",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max open orders to scan in one call (default 1000, max ${MAX_OPEN_ORDER_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
    const orderModule: any = container.resolve(Modules.ORDER)

    const filters: Record<string, unknown> = {
      status: { $nin: CLOSED_ORDER_STATUSES },
    }
    if (order_id) {
      filters.id = order_id
    }

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "canceled_at",
        "items.id",
        "items.requires_shipping",
        "fulfillments.id",
        "fulfillments.requires_shipping",
        "fulfillments.canceled_at",
        "fulfillments.items.line_item_id",
        "fulfillments.shipping_option.service_zone.fulfillment_set.type",
      ],
      filters,
      pagination: { take: limit },
    })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let fulfillmentCount = 0
    let lineItemCount = 0

    for (const order of (orders || []) as any[]) {
      // `canceled_at` is belt-and-braces: the status filter already excludes
      // canceled orders, but a partially-migrated row could carry one without
      // the status.
      if (order.canceled_at) continue

      const { fulfillmentIds, lineItemIds } = planOrderRepair(order)

      for (const fulfillmentId of fulfillmentIds) {
        fulfillmentCount++
        changes.push({
          entity: "fulfillment",
          id: fulfillmentId,
          field: `requires_shipping (order ${order.display_id ?? order.id})`,
          before: false,
          after: true,
        })
        if (!dry_run) {
          try {
            // See the note at the top of this file: the column is writable
            // through the spread in `updateFulfillment_`, but absent from the
            // public DTO — hence the cast.
            await fulfillmentModule.updateFulfillment(fulfillmentId, {
              requires_shipping: true,
            } as any)
          } catch (e: any) {
            errors.push({ id: fulfillmentId, message: e?.message ?? String(e) })
          }
        }
      }

      for (const lineItemId of lineItemIds) {
        lineItemCount++
        changes.push({
          entity: "order_line_item",
          id: lineItemId,
          field: `requires_shipping (order ${order.display_id ?? order.id})`,
          before: false,
          after: true,
        })
        if (!dry_run) {
          try {
            await orderModule.updateOrderLineItems(lineItemId, {
              requires_shipping: true,
            })
          } catch (e: any) {
            errors.push({ id: lineItemId, message: e?.message ?? String(e) })
          }
        }
      }
    }

    return {
      job_id: backfillOpenOrderRequiresShippingJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary: summarizeRequiresShippingBackfill(
        dry_run,
        (orders || []).length,
        fulfillmentCount,
        lineItemCount
      ),
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
