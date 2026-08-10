import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import {
  getInventoryOrderRoute,
  setInventoryOrderRoute,
} from "../../../../workflows/inventory_orders/lib/repoint-route"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — repair an inventory order's ROUTE (both ends: ship-from and
 * deliver-to), including the reversed-order case.
 *
 * `repair-inventory-order-source` moves only the FROM end, and refuses when the
 * requested source is the order's current destination. That refusal is correct
 * for its own job — but it makes a *reversed* order unrepairable, because a
 * reversal is exactly the case where the correct source is the current
 * destination. Nothing else writes the to-link: the PUT route silently drops
 * `to_stock_location_id` (it isn't in the update workflow's acted-on set) and is
 * gated to Pending/Processing besides, so a Shipped/Delivered order has no
 * repair path at all today.
 *
 * Found via `inv_order_01KVCT5Z…` (17.6 m FAB-HAN-IND-001): stored
 * from=Dharamshala / to=Shramdaan when the fabric was woven at Shramdaan and
 * delivered to Dharamshala. Delivery posted the stock at the reversed
 * destination, so the material sat at the partner's location and never appeared
 * in our own warehouse.
 *
 * ⚠️ This job repairs LINKS ONLY. It deliberately does not move inventory:
 * `metadata.partner_delivered_lines` records `{order_line_id, quantity}` with no
 * location, so a re-delivery after the fix computes `remaining = 0` and posts
 * nothing. Stock already sitting at the wrong location must be corrected
 * separately via the location-levels endpoints. The summary says so on every
 * applied run.
 *
 * Dry-run (default) previews the change set without writing.
 */

const paramsSchema = z
  .object({
    order_id: z.string().min(1, "order_id is required"),
    from_stock_location_id: z.string().min(1).optional(),
    to_stock_location_id: z.string().min(1).optional(),
    swap: z.boolean().optional().default(false),
  })
  .refine(
    (v) => v.swap || v.from_stock_location_id || v.to_stock_location_id,
    "provide swap:true, or at least one of from_stock_location_id / to_stock_location_id"
  )
  .refine(
    (v) => !(v.swap && (v.from_stock_location_id || v.to_stock_location_id)),
    "swap:true reverses the order's existing ends — do not also pass explicit locations"
  )

export type RouteRepairPlanInput = {
  orderId: string
  current: { fromId: string | null; toId: string | null }
  target: { fromId: string | null; toId: string | null }
  /**
   * The unified core-order mirror (#342). Its `metadata.from_stock_location_id`
   * is a display copy the partner UI reads, and goes stale when the from-link
   * moves.
   */
  unified?: { id: string; fromInMetadata: string | null } | null
}

/**
 * PURE: plan the repair, or explain why it must not run. Exported for tests.
 */
export function planRouteRepair(
  input: RouteRepairPlanInput
): { changes: MaintenanceChange[]; blocker?: string } {
  const { fromId, toId } = input.target

  if (!fromId || !toId) {
    return {
      changes: [],
      blocker:
        "the order is missing one end of its route — pass both from_stock_location_id and to_stock_location_id explicitly",
    }
  }
  if (fromId === toId) {
    return {
      changes: [],
      blocker:
        "source and destination are the same stock location — a shipment cannot originate at its own destination",
    }
  }

  const changes: MaintenanceChange[] = []

  if (input.current.fromId !== fromId) {
    changes.push({
      entity: "inventory_order",
      id: input.orderId,
      field: "from_stock_location (link)",
      before: input.current.fromId,
      after: fromId,
    })
  }
  if (input.current.toId !== toId) {
    changes.push({
      entity: "inventory_order",
      id: input.orderId,
      field: "to_stock_location (link)",
      before: input.current.toId,
      after: toId,
    })
  }

  // Compared against the TARGET so a re-run after a partial apply still
  // converges the mirror.
  if (input.unified && input.unified.fromInMetadata !== fromId) {
    changes.push({
      entity: "order",
      id: input.unified.id,
      field: "metadata.from_stock_location_id",
      before: input.unified.fromInMetadata,
      after: fromId,
    })
  }

  return { changes }
}

export const repairInventoryOrderRouteJob: MaintenanceJob = {
  id: "repair-inventory-order-route",
  label: "Repair inventory-order route (ship-from / deliver-to, incl. reversed)",
  description:
    "Rewrite both ends of an inventory order's stock-location route. Handles the reversed-order case that repair-inventory-order-source cannot (it refuses when the correct source is the current destination) and the to-link that no route writes at all. Pass swap:true to reverse the existing ends, or set from/to explicitly. Ungated by order status. Repairs LINKS ONLY — stock already posted at the wrong location must be corrected via the location-levels endpoints. Dry-run previews the change set.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: true,
      description: "ID of the inventory order to repair",
    },
    {
      name: "swap",
      type: "boolean",
      required: false,
      description:
        "Reverse the order's existing ends (the reversed-order fix). Cannot be combined with explicit locations.",
    },
    {
      name: "from_stock_location_id",
      type: "string",
      required: false,
      description: "The CORRECT source stock location the order ships from",
    },
    {
      name: "to_stock_location_id",
      type: "string",
      required: false,
      description: "The CORRECT destination stock location the order delivers to",
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
    const { order_id, from_stock_location_id, to_stock_location_id, swap } =
      parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "status"],
      filters: { id: order_id },
    })
    const order = orders?.[0]
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order not found: ${order_id}`
      )
    }

    const current = await getInventoryOrderRoute(container, order_id)

    const target = swap
      ? { fromId: current.toId, toId: current.fromId }
      : {
          fromId: from_stock_location_id ?? current.fromId,
          toId: to_stock_location_id ?? current.toId,
        }

    // Both ends must be live (non-deleted) stock locations.
    for (const [label, id] of [
      ["from_stock_location_id", target.fromId],
      ["to_stock_location_id", target.toId],
    ] as const) {
      if (!id) {
        continue
      }
      const { data: locs } = await query.graph({
        entity: "stock_location",
        fields: ["id", "name"],
        filters: { id },
      })
      if (!locs?.[0]) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Stock location not found (or deleted) for ${label}: ${id}`
        )
      }
    }

    // The unified core-order mirror carries a display copy of
    // from_stock_location_id that the partner UI reads.
    let unifiedOrder: { id: string; metadata: Record<string, any> | null } | null =
      null
    try {
      const { data: withOrder } = await query.graph({
        entity: "inventory_orders",
        fields: ["order.id", "order.metadata"],
        filters: { id: order_id },
      })
      const raw = withOrder?.[0]?.order
      const unified = Array.isArray(raw) ? raw[0] : raw
      if (unified?.id) {
        unifiedOrder = { id: unified.id, metadata: unified.metadata ?? null }
      }
    } catch {
      // No unified mirror (pre-#342 order) — nothing to sync.
    }

    const plan = planRouteRepair({
      orderId: order_id,
      current,
      target,
      unified: unifiedOrder
        ? {
            id: unifiedOrder.id,
            fromInMetadata:
              (unifiedOrder.metadata as any)?.from_stock_location_id ?? null,
          }
        : null,
    })
    if (plan.blocker) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, plan.blocker)
    }

    const linkChanged = plan.changes.some((c) =>
      String(c.field).endsWith("(link)")
    )

    if (!dry_run && plan.changes.length > 0) {
      if (linkChanged) {
        await setInventoryOrderRoute(
          container,
          order_id,
          target.fromId as string,
          target.toId as string
        )
      }
      if (
        unifiedOrder &&
        plan.changes.some((c) => c.field === "metadata.from_stock_location_id")
      ) {
        // The ORDER module's updateOrders REPLACES metadata wholesale —
        // read-then-merge so the unification keys survive.
        const orderService: any = container.resolve(Modules.ORDER)
        await orderService.updateOrders([
          {
            id: unifiedOrder.id,
            metadata: {
              ...(unifiedOrder.metadata || {}),
              from_stock_location_id: target.fromId,
            },
          },
        ])
      }
    }

    const summary =
      plan.changes.length === 0
        ? `No changes — order ${order_id} already routes ${target.fromId} → ${target.toId}`
        : `${dry_run ? "Would apply" : "Applied"} ${plan.changes.length} change(s) on order ${order_id}: ${current.fromId} → ${current.toId} becomes ${target.fromId} → ${target.toId}.${
            linkChanged
              ? " Links only — stock already posted at the previous destination is NOT moved; correct it via the location-levels endpoints."
              : ""
          }`

    return {
      job_id: repairInventoryOrderRouteJob.id,
      dry_run,
      applied: !dry_run && plan.changes.length > 0,
      summary,
      changes: plan.changes,
    }
  },
}
