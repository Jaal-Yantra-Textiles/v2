import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import {
  getInventoryOrderFromLinkId,
  repointInventoryOrderFromLink,
} from "../../../../workflows/inventory_orders/lib/repoint-from-location"
import inventoryOrdersStockLocations from "../../../../links/inventory-orders-stock-locations"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — repair an inventory order's ship-from (source location).
 *
 * An order created against the WRONG source stock location (a near-duplicate
 * picked in the admin dropdown, or a location later deleted) is stranded: the
 * shipment + rates flows deliberately refuse to guess an origin (#772 — no
 * cross-warehouse fallback on the shared Shiprocket account), and the PUT
 * update route is gated to Pending/Processing (#778 H8). This job is the
 * ungated, audited repair path:
 *
 *   - repoints the order↔stock-location FROM-link to the correct source
 *     (dismiss old link if any, create the new one) — idempotent;
 *   - optionally clears a STALE `metadata.shipment` blob left by a
 *     mis-assigned shipment attempt (clear_stale_shipment=true). Refuses to
 *     clear a blob that carries a real AWB/tracking number — that is a live
 *     consignment, not residue.
 *
 * Dry-run (default) previews the link + metadata changes without writing.
 */

const paramsSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
  from_stock_location_id: z
    .string()
    .min(1, "from_stock_location_id is required"),
  clear_stale_shipment: z.boolean().optional().default(false),
})

export type SourceRepairPlanInput = {
  orderId: string
  currentFromId: string | null
  targetFromId: string
  toLocationId: string | null
  /** The order's metadata.shipment blob (or null/undefined when absent). */
  shipment: Record<string, unknown> | null | undefined
  clearStaleShipment: boolean
}

/**
 * PURE: plan the repair. Returns the change set, or a blocker explaining why
 * the repair must not run (target == destination; shipment blob carries a
 * real AWB/tracking). Exported for unit tests.
 */
export function planSourceRepair(
  input: SourceRepairPlanInput
): { changes: MaintenanceChange[]; blocker?: string } {
  if (input.toLocationId && input.targetFromId === input.toLocationId) {
    return {
      changes: [],
      blocker:
        "from_stock_location_id is the order's destination (to-location) — a shipment cannot originate at its own destination",
    }
  }

  const changes: MaintenanceChange[] = []

  if (input.currentFromId !== input.targetFromId) {
    changes.push({
      entity: "inventory_order",
      id: input.orderId,
      field: "from_stock_location (link)",
      before: input.currentFromId,
      after: input.targetFromId,
    })
  }

  if (input.clearStaleShipment && input.shipment) {
    const awb = String((input.shipment as any).awb ?? "").trim()
    const tracking = String((input.shipment as any).tracking_number ?? "").trim()
    if (awb || tracking) {
      return {
        changes: [],
        blocker: `metadata.shipment carries a real consignment (awb="${awb}", tracking="${tracking}") — refusing to clear it; cancel/handle the carrier shipment first`,
      }
    }
    changes.push({
      entity: "inventory_order",
      id: input.orderId,
      field: "metadata.shipment",
      before: input.shipment,
      after: null,
    })
  }

  return { changes }
}

export const repairInventoryOrderSourceJob: MaintenanceJob = {
  id: "repair-inventory-order-source",
  label: "Repair inventory-order ship-from (source location)",
  description:
    "Repoint an inventory order's from-location link to the correct source stock location (mispicked or deleted source — the wrong-warehouse pickup incident, #772). Optionally clears a stale metadata.shipment blob left by a mis-assigned shipment attempt (refused when it carries a real AWB/tracking). Dry-run previews the link + metadata changes; apply is idempotent. Ungated by order status — this is the repair path the Pending/Processing PUT gate doesn't cover.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: true,
      description: "ID of the inventory order to repair",
    },
    {
      name: "from_stock_location_id",
      type: "string",
      required: true,
      description: "The CORRECT source stock location the order ships from",
    },
    {
      name: "clear_stale_shipment",
      type: "boolean",
      required: false,
      description:
        "Also clear metadata.shipment when it is stale residue (no AWB/tracking) from a mis-assigned attempt (default false)",
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
    const { order_id, from_stock_location_id, clear_stale_shipment } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "metadata"],
      filters: { id: order_id },
    })
    const order = orders?.[0]
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order not found: ${order_id}`
      )
    }

    // The target must be a live (non-deleted) stock location.
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
      filters: { id: from_stock_location_id },
    })
    if (!locs?.[0]) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Stock location not found (or deleted): ${from_stock_location_id}`
      )
    }

    // Current link state: from-link + to-link (destination guard).
    const currentFromId = await getInventoryOrderFromLinkId(container, order_id)
    const { data: links } = await query.graph({
      entity: (inventoryOrdersStockLocations as any).entryPoint,
      fields: ["stock_location_id", "to_location"],
      filters: { inventory_orders_id: order_id },
    })
    const toLocationId =
      ((links || []) as any[]).find((l) => l?.to_location)?.stock_location_id ??
      null

    const plan = planSourceRepair({
      orderId: order_id,
      currentFromId,
      targetFromId: from_stock_location_id,
      toLocationId,
      shipment: (order.metadata as any)?.shipment ?? null,
      clearStaleShipment: clear_stale_shipment,
    })
    if (plan.blocker) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, plan.blocker)
    }

    if (!dry_run && plan.changes.length > 0) {
      if (plan.changes.some((c) => c.field === "from_stock_location (link)")) {
        await repointInventoryOrderFromLink(
          container,
          order_id,
          from_stock_location_id
        )
      }
      if (plan.changes.some((c) => c.field === "metadata.shipment")) {
        // Medusa metadata updates MERGE key-wise; an explicit null clears the key.
        const inventoryOrderService: any = container.resolve(
          ORDER_INVENTORY_MODULE
        )
        await inventoryOrderService.updateInventoryOrders({
          id: order_id,
          metadata: { shipment: null },
        })
      }
    }

    const summary =
      plan.changes.length === 0
        ? `No changes — order ${order_id} already ships from ${from_stock_location_id}${clear_stale_shipment ? " and has no metadata.shipment residue" : ""}`
        : `${dry_run ? "Would apply" : "Applied"} ${plan.changes.length} change(s) on order ${order_id}: ${plan.changes.map((c) => c.field).join(", ")}`

    return {
      job_id: repairInventoryOrderSourceJob.id,
      dry_run,
      applied: !dry_run && plan.changes.length > 0,
      summary,
      changes: plan.changes,
    }
  },
}
