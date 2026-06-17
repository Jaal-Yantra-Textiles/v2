import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations"
import {
  dualWriteUnifiedOrderStep,
  mirrorPartnerLinkOnUnifiedOrderStep,
  mirrorUnifiedOrderStatusStep,
} from "./dual-write-unified-order"

// #445 / #342 T4 — project a legacy-only inventory order onto the unified core
// `order` surface AFTER the fact. The create-path projection
// (`dualWriteUnifiedOrderStep`) only ran for orders created once dual-write
// existed (T2+). The link-only T4 backfill
// (`backfill-unified-order-links.ts`) deliberately left pre-T2 rows — the 90
// `noBackref` rows from the 2026-06-14 prod run — legacy-only, so partners like
// GOF can't see those orders under `/orders` (the unified surface). This
// workflow rebuilds the SAME projection the create path would have produced,
// from current DB state, reusing the exact same steps so semantics never drift.
//
// Idempotency is the CALLER's responsibility: only invoke this for orders that
// have neither the order↔inventory_order link NOR a `metadata.unified_order_id`
// backref — `dualWriteUnifiedOrderStep` is create-once (no link-existence guard)
// and would otherwise mint a duplicate unified order. The backfill script
// (`backfill-unified-order-projections.ts`) enforces that filter.

type GatherResult = {
  order: any
  orderLines: any[]
  input: {
    stock_location_id: string
    from_stock_location_id?: string
    to_stock_location_id?: string
    order_lines: { inventory_item_id: string; quantity: number; price: number }[]
  }
  partnerId: string | null
}

// Reconstruct the exact `{ order, orderLines, input }` shape the create-path
// dual-write received, from the persisted legacy row + its module links.
export const gatherLegacyProjectionInputStep = createStep(
  "gather-legacy-projection-input",
  async ({ inventoryOrderId }: { inventoryOrderId: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "*",
        "orderlines.*",
        "orderlines.inventory_items.*",
        "partner.*",
      ],
      filters: { id: inventoryOrderId },
    })
    const order = orders?.[0]
    if (!order) {
      throw new Error(`inventory order ${inventoryOrderId} not found`)
    }

    // to/from stock locations live on the link's extra columns, so read the
    // link entryPoint directly (same approach as list-single-inventory-order).
    const { data: locLinks } = await query.graph({
      entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
      fields: ["from_location", "to_location", "stock_location_id"],
      filters: { inventory_orders_id: inventoryOrderId },
    })
    let toLocationId: string | undefined
    let fromLocationId: string | undefined
    for (const l of (locLinks as any[]) || []) {
      if (l?.to_location && l?.stock_location_id) toLocationId = l.stock_location_id
      if (l?.from_location && l?.stock_location_id) fromLocationId = l.stock_location_id
    }

    const orderLines = Array.isArray(order.orderlines) ? order.orderlines : []
    // Same index alignment the create path relies on: dual-write maps
    // orderLines[idx] ↔ input.order_lines[idx].
    const order_lines = orderLines.map((ol: any) => ({
      inventory_item_id: ol?.inventory_items?.[0]?.id,
      quantity: Number(ol?.quantity),
      price: Number(ol?.price),
    }))

    // inventory_orders → partner can be a list or a single depending on link
    // directionality; normalise to a single id (work-orders have one partner).
    const partnerId = Array.isArray(order.partner)
      ? order.partner?.[0]?.id ?? null
      : order.partner?.id ?? null

    const result: GatherResult = {
      order,
      orderLines,
      input: {
        stock_location_id: (toLocationId ?? fromLocationId ?? "") as string,
        to_stock_location_id: toLocationId,
        from_stock_location_id: fromLocationId,
        order_lines,
      },
      partnerId,
    }
    return new StepResponse(result)
  }
)

export const backfillInventoryOrderProjectionWorkflow = createWorkflow(
  { name: "backfill-inventory-order-projection", store: true },
  (input: { inventoryOrderId: string }) => {
    const prep = gatherLegacyProjectionInputStep(input)

    // Same create-path projection: mint the unified order + the authoritative
    // order↔inventory_order link (rolls back the order if the link fails).
    const dw = dualWriteUnifiedOrderStep({
      order: prep.order,
      orderLines: prep.orderLines,
      input: prep.input,
    })

    // Gating on `dw.unified_order_id` also FORCES ordering — these mirror steps
    // resolve the unified order via the freshly-created link, so they must run
    // after the projection, not race it.
    when({ dw, prep }, ({ dw, prep }) =>
      Boolean(dw?.unified_order_id) && Boolean(prep?.partnerId)
    ).then(() => {
      mirrorPartnerLinkOnUnifiedOrderStep({
        inventoryOrderId: input.inventoryOrderId,
        partnerId: prep.partnerId as unknown as string,
      })
    })

    // Bring the unified order's status in line with the legacy row's CURRENT
    // status (the partner mirror only stamps "assigned"). §5 map handles
    // Processing/Shipped/Partial/Delivered → core status + partner_status.
    when({ dw }, ({ dw }) => Boolean(dw?.unified_order_id)).then(() => {
      mirrorUnifiedOrderStatusStep({ inventoryOrderId: input.inventoryOrderId })
    })

    return new WorkflowResponse(dw)
  }
)

export default backfillInventoryOrderProjectionWorkflow
