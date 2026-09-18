import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { resolveExistingLevelsStep } from "./partner-complete-inventory-order"
import {
  planInventoryOrderReceipt,
  postingsFromPlannedLines,
  type PlannedReceiptLine,
} from "./lib/plan-inventory-order-receipt"

/**
 * ADMIN RECEIPT — record that goods actually turned up, and put them on the
 * books (#2115, #2111).
 *
 * This is the door that did not exist. `partner-complete-inventory-order` posts
 * stock, but only from `Processing`/`Partial` and only when the PARTNER submits
 * delivered lines. An order the carrier marked `Delivered` — the pashminas at
 * Kiyo — could be received through no door at all, and its level stayed at zero
 * with nothing having errored.
 *
 * 🔴 The destination is the ORDER's destination, which for a consignment order
 * is a PARTNER's location. That is deliberate and is half of #2111: material we
 * procured, stocked where the partner will cut it, and deducted there when it
 * becomes a garment. The other half is the consumption gate in
 * `consumption-logs/lib/apply-to-inventory.ts`, and the two ship together —
 * receipt alone would stock material that could never come off again.
 *
 * Idempotency is cumulative, not a flag: the plan measures against
 * `line_fulfillments` and refuses over-receipt, so calling this twice on a
 * fully-received order receives nothing rather than posting twice.
 */

export type ReceiveInventoryOrderInput = {
  orderId: string
  /**
   * Omit to receive everything still outstanding. Repeat an `order_line_id`
   * with different `stock_location_id`s to split one delivery across two
   * destinations (#2144).
   */
  lines?: Array<{
    order_line_id: string
    quantity: number
    stock_location_id?: string | null
  }> | null
  /** Override the order's destination location. */
  stock_location_id?: string | null
  notes?: string | null
  received_by?: string | null
}

const planReceiptStep = createStep(
  "receive-inventory-order-plan",
  async (input: ReceiveInventoryOrderInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "status",
        "metadata",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.stock_locations.id",
        // The cumulative record of what has already been received. This is what
        // makes a second call a no-op instead of a second posting.
        "orderlines.line_fulfillments.quantity_delta",
        // The order's own destination — a partner's location on a consignment
        // order, and the whole point of the exercise.
        "stock_locations.id",
      ],
      filters: { id: input.orderId },
    })

    const order = orders?.[0]
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order ${input.orderId} not found`
      )
    }

    const lines = ((order as any).orderlines ?? [])
      .filter(Boolean)
      .map((ol: any) => ({
        id: String(ol.id),
        quantity: ol.quantity ?? 0,
        received: ((ol.line_fulfillments || []) as any[]).reduce(
          (s, f) => s + (Number(f?.quantity_delta) || 0),
          0
        ),
        inventory_item_id: (ol.inventory_items || [])[0]?.id ?? null,
        item_location_ids: ((ol.inventory_items || [])[0]?.stock_locations || [])
          .map((sl: any) => sl?.id)
          .filter(Boolean),
      }))

    const plan = planInventoryOrderReceipt({
      order_id: input.orderId,
      status: (order as any).status,
      destination_location_id:
        ((order as any).stock_locations || [])[0]?.id ?? null,
      location_id: input.stock_location_id ?? null,
      lines,
      requested: input.lines ?? null,
    })

    if (!plan.ok) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, plan.error)
    }

    return new StepResponse({
      lines: plan.lines,
      destination_location_id: plan.destination_location_id,
      destination_location_ids: plan.destination_location_ids,
      postings: postingsFromPlannedLines(plan.lines),
    })
  }
)

/**
 * Write one `line_fulfillment` per received line and link it to the order.
 *
 * Shaped exactly like the partner path's equivalent, and deliberately so: both
 * doors have to write the SAME cumulative record, or each would be blind to
 * what the other received and they would post the same goods twice.
 */
const recordReceiptFulfillmentsStep = createStep(
  "receive-inventory-order-record-fulfillments",
  async (
    input: {
      orderId: string
      lines: PlannedReceiptLine[]
      notes?: string | null
      received_by?: string | null
    },
    { container, context }
  ) => {
    const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as unknown as Link

    const createdIds: string[] = []
    for (const l of input.lines) {
      const entry = await service.createLine_fulfillments({
        quantity_delta: l.quantity,
        event_type: "received",
        transaction_id: context.transactionId,
        notes: input.notes ?? undefined,
        metadata: {
          workflow_type: "admin_receipt",
          source: "receive-inventory-order",
          received_by: input.received_by ?? null,
          received_at: new Date().toISOString(),
          location_id: l.location_id,
        },
      })
      createdIds.push(entry.id)

      await remoteLink.create([
        {
          [ORDER_INVENTORY_MODULE]: { inventory_order_line_id: l.order_line_id },
          [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: entry.id },
        },
        {
          [ORDER_INVENTORY_MODULE]: { inventory_orders_id: input.orderId },
          [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: entry.id },
        },
      ])
    }

    return new StepResponse({ count: createdIds.length, ids: createdIds }, {
      ids: createdIds,
    })
  },
  async (rb: any, { container }) => {
    if (!rb?.ids?.length) {
      return
    }
    const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    for (const id of rb.ids as string[]) {
      try {
        await service.deleteLine_fulfillments(id)
      } catch {
        // best effort: the level rollback is the one that matters
      }
    }
  }
)

/** An audit line on the order itself, so the receipt is visible in the timeline. */
const recordReceiptActivityStep = createStep(
  "receive-inventory-order-record-activity",
  async (
    input: {
      orderId: string
      postings: Array<{ inventory_item_id: string; location_id: string; quantity: number }>
      notes?: string | null
      received_by?: string | null
    },
    { container }
  ) => {
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    if (typeof service?.createInventoryOrderActivities !== "function") {
      return new StepResponse(null)
    }
    // Shape mirrors `buildInventoryOrderActivity` exactly — `activity_type` is a
    // four-value ENUM (a new value here would be rejected at write time), so the
    // specific event goes in the free-text `kind`.
    const row = await service.createInventoryOrderActivities({
      inventory_order_id: input.orderId,
      activity_type: "lifecycle_event",
      kind: "goods_received",
      actor_type: "admin",
      actor_id: input.received_by ?? null,
      partner_id: null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: `Goods received onto stock: ${input.postings
        .map((p) => `${p.quantity} × ${p.inventory_item_id} @ ${p.location_id}`)
        .join(", ")}`,
      payload: {
        source: "receive-inventory-order",
        postings: input.postings,
        notes: input.notes ?? null,
      },
      occurred_at: new Date(),
    })
    return new StepResponse(row, row?.id)
  },
  async (rowId: string | undefined, { container }) => {
    if (!rowId) {
      return
    }
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)
    try {
      await service.deleteInventoryOrderActivities(rowId)
    } catch {
      // best effort
    }
  }
)

export const receiveInventoryOrderWorkflow = createWorkflow(
  "receive-inventory-order",
  (input: ReceiveInventoryOrderInput) => {
    const plan = planReceiptStep(input)

    recordReceiptFulfillmentsStep({
      orderId: input.orderId,
      lines: plan.lines,
      notes: input.notes,
      received_by: input.received_by,
    })

    // The posting itself, in the same shape as the partner path: resolve which
    // levels exist, create the ones that do not, then add to the rest.
    //
    // Deliberately NOT extracted into a shared helper with
    // `partner-complete-inventory-order`. That path had `approval gates the
    // goods posting` (#891) land on it days ago and is what actually moves real
    // goods today; the duplication here is the price of not reshaping it while
    // proving a new door works.
    const levels = transform({ plan }, ({ plan }) =>
      (plan.postings || []).map((p: any) => ({
        location_id: String(p.location_id),
        inventory_item_id: String(p.inventory_item_id),
        stocked_quantity: Number(p.quantity) || 0,
      }))
    )

    const resolved = resolveExistingLevelsStep({ levels }) as any
    const existing = transform(
      { resolved },
      ({ resolved }) => resolved?.existing || []
    )

    const createInputs = transform({ existing, levels }, ({ existing, levels }) => {
      const exArr = (existing as any[]) || []
      return ((levels as any[]) || [])
        .filter(
          (l) =>
            !exArr.some(
              (ex) =>
                ex.inventory_item_id === l.inventory_item_id &&
                ex.location_id === l.location_id
            )
        )
        .map((l) => ({
          inventory_item_id: String(l.inventory_item_id),
          location_id: String(l.location_id),
          stocked_quantity: Number(l.stocked_quantity || 0),
          incoming_quantity: 0,
        }))
    })

    const hasCreates = transform(
      { createInputs },
      ({ createInputs }) => ((createInputs as any[]) || []).length > 0
    )

    when(hasCreates, (b) => Boolean(b)).then(() => {
      createInventoryLevelsWorkflow.runAsStep({
        input: { inventory_levels: createInputs as unknown as any[] },
      })
    })

    const updates = transform({ existing, levels }, ({ existing, levels }) => {
      const lvlArr = (levels as any[]) || []
      return (((existing as any[]) || []) as any[]).map((ex) => {
        const found = lvlArr.find(
          (l) =>
            l.inventory_item_id === ex.inventory_item_id &&
            l.location_id === ex.location_id
        )
        return {
          id: String(ex.id),
          inventory_item_id: String(ex.inventory_item_id),
          location_id: String(ex.location_id),
          stocked_quantity:
            Number(ex.stocked_quantity || 0) + Number(found?.stocked_quantity || 0),
        }
      })
    })

    const hasUpdates = transform(
      { updates },
      ({ updates }) => ((updates as any[]) || []).length > 0
    )

    when(hasUpdates, (b) => Boolean(b)).then(() => {
      updateInventoryLevelsWorkflow.runAsStep({
        input: { updates: updates as any },
      })
    })

    recordReceiptActivityStep({
      orderId: input.orderId,
      postings: plan.postings,
      notes: input.notes,
      received_by: input.received_by,
    })

    return new WorkflowResponse({
      order_id: input.orderId,
      received: plan.lines,
      postings: plan.postings,
      // Singular, kept for callers that predate splitting; on a split receipt
      // it names only ONE of the places the goods went.
      destination_location_id: plan.destination_location_id,
      destination_location_ids: plan.destination_location_ids,
    })
  }
)

export default receiveInventoryOrderWorkflow

/** Convenience for callers outside a workflow (routes, MCP, maintenance jobs). */
export const runReceiveInventoryOrder = async (
  container: MedusaContainer,
  input: ReceiveInventoryOrderInput
) => receiveInventoryOrderWorkflow(container as any).run({ input })
