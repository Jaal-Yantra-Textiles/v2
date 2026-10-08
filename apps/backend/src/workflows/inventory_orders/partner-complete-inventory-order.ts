import { createStep, createWorkflow, StepResponse, WorkflowResponse, when, transform } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import type { RemoteQueryFunction } from "@medusajs/types";
import { TASKS_MODULE } from "../../modules/tasks";
import { createTasksFromTemplatesWorkflow } from "./create-tasks-from-templates";
import { updateInventoryOrderWorkflow } from "./update-inventory-order";
import { setInventoryOrderStepSuccessWorkflow } from "./inventory-order-steps";
import TaskService from "../../modules/tasks/service";
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders";
import Fullfilled_ordersService from "../../modules/fullfilled_orders/service";
import { exceedsOrdered, lineLedger, sumDispatchedByLine } from "./lib/dispatch-ledger";

export type PartnerCompleteOrderLine = {
  order_line_id: string
  quantity: number
}

export type PartnerCompleteInventoryOrderInput = {
  orderId: string
  notes?: string
  deliveryDate?: string
  trackingNumber?: string
  /**
   * Ignored since #2289: a supplier no longer chooses where stock lands, because
   * their Complete posts no stock. Kept so existing callers still validate.
   */
  stock_location_id?: string
  lines: PartnerCompleteOrderLine[]
  // #780 C1 defense-in-depth — when supplied (the partner route always supplies
  // it), the workflow re-verifies the order is linked to this partner and
  // throws NOT_FOUND otherwise, so ownership is enforced inside the workflow and
  // not only at the route. Optional so admin/internal callers can omit it.
  partnerId?: string
}

// Step: prepare fulfillment payloads (filters happen inside the step)

// Step: resolve existing inventory levels for given (item, location) pairs
export const resolveExistingLevelsStep = createStep(
  "partner-complete-resolve-existing-levels",
  async (
    input: { levels: Array<{ location_id: string; inventory_item_id: string; stocked_quantity: number }> },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const levels = input.levels || []
    const existing: Array<{ id: string; location_id: string; inventory_item_id: string; stocked_quantity: number }> = []
    for (const lv of levels) {
      try {
        const { data } = await query.graph({
          entity: "inventory_level",
          fields: ["id", "inventory_item_id", "location_id", "stocked_quantity"],
          filters: { inventory_item_id: lv.inventory_item_id, location_id: lv.location_id },
        })
        if (Array.isArray(data) && data.length > 0) {
          const node = data[0] as any
          existing.push({
            id: String(node.id),
            location_id: String(node.location_id),
            inventory_item_id: String(node.inventory_item_id),
            stocked_quantity: Number(node.stocked_quantity) || 0,
          })
        }
      } catch {
        // ignore, we only care about matches
      }
    }
    return new StepResponse({ existing })
  }
)

/**
 * #2289 — record the supplier's lines as DISPATCHES. No `line_fulfillment`
 * (receipt) rows and no stock: only a receiver's count posts stock (admin
 * receive, or the receiving partner's Incoming deliveries confirm).
 *
 * Re-checks against ordered quantities inside the write, so two concurrent
 * submissions cannot both pass the validation step's guard.
 */
const createDispatchEntriesStep = createStep(
  "partner-complete-create-dispatch-entries",
  async (
    input: {
      orderId: string
      partnerId?: string
      notes?: string
      deliveryDate?: string
      trackingNumber?: string
      lines: Array<{ order_line_id: string; quantity: number }>
    },
    { container, context }
  ) => {
    const service: Fullfilled_ordersService = container.resolve(FULLFILLED_ORDERS_MODULE) as any
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    const lines = (input.lines || []).filter(
      (l) => l && typeof l.quantity === "number" && l.quantity > 0
    )
    if (!lines.length) return new StepResponse({ count: 0, ids: [] as string[] }, { ids: [] as string[] })

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "orderlines.id", "orderlines.quantity", "orderlines.line_fulfillments.quantity_delta"],
      filters: { id: input.orderId },
    })
    const order = orders?.[0] as any
    const existing = await (service as any).listInventoryDispatches(
      { inventory_order_id: input.orderId },
      { take: null }
    )
    const dispatched = sumDispatchedByLine(existing)
    for (const l of lines) {
      const ol = (order?.orderlines ?? []).find((x: any) => String(x?.id) === l.order_line_id)
      if (!ol) continue
      const ledger = lineLedger(ol, dispatched)
      if (exceedsOrdered(ledger, l.quantity)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Concurrent conflict: line ${l.order_line_id} has ${ledger.to_dispatch.toFixed(2)} left to send but attempted to send ${l.quantity}`
        )
      }
    }

    const now = new Date()
    const created = await (service as any).createInventoryDispatches(
      lines.map((l) => ({
        inventory_order_id: input.orderId,
        inventory_order_line_id: l.order_line_id,
        quantity: l.quantity,
        partner_id: input.partnerId ?? null,
        dispatched_at: now,
        delivery_date: input.deliveryDate ?? null,
        tracking_number: input.trackingNumber ?? null,
        notes: input.notes ?? null,
        transaction_id: context.transactionId ?? null,
        metadata: { source: "partner-complete-inventory-order" },
      }))
    )
    const ids = (Array.isArray(created) ? created : [created]).map((c: any) => String(c.id))
    return new StepResponse({ count: ids.length, ids }, { ids })
  },
  async (rb, { container }) => {
    if (!rb?.ids?.length) return
    const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    try { await service.deleteInventoryDispatches(rb.ids) } catch {}
  }
)

const validateAndFetchOrderStep = createStep(
  "partner-complete-validate-and-fetch-order",
  async (input: PartnerCompleteInventoryOrderInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "*",
        "orderlines.*",
        // fetch inventory item linkage and stock location information for stock posting
        "orderlines.inventory_items.*",
        "orderlines.inventory_items.stock_locations.*",
        // include order-level stock locations as a fallback destination
        "stock_locations.*",
        // include existing fulfillments to compute cumulative delivered qty
        "orderlines.line_fulfillments.quantity_delta",
        // #780 C1 defense-in-depth — the linked partner, to re-verify ownership
        // inside the workflow.
        "partner.id",
      ],
      filters: { id: input.orderId },
    })

    if (!orders || orders.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.orderId} not found`)
    }

    const order = orders[0]

    // #780 C1 defense-in-depth — enforce partner ownership inside the workflow,
    // not just at the route. NOT_FOUND (not NOT_ALLOWED) so a foreign caller
    // can't distinguish "exists but not yours" from "doesn't exist".
    if (input.partnerId && (order as any).partner?.id !== input.partnerId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.orderId} not found`)
    }

    // #778 H3 — the order's `status` column is the SINGLE source of truth for
    // "is this order in a partner-started state". Processing (started) or Partial
    // (mid partial-delivery) may receive a completion; anything else may not.
    // (The old duplicate `metadata.partner_status` guard was redundant with this
    // — status and that metadata field were always written in lockstep — and is
    // removed along with the metadata writes to end the triple-source drift.)
    if (!(((order as any).status === "Processing") || ((order as any).status === "Partial"))) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${input.orderId} not in an updatable state (status: ${order.status})`)
    }

    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `lines must be a non-empty array`)
    }

    // Build a set of valid order line IDs for validation
    const validLineIds = new Set(
      (order.orderlines ?? []).filter(Boolean).map((ol: any) => String(ol.id))
    )

    // Build easy lookup for delivered quantities
    const deliveredByLine: Record<string, number> = {}
    for (const l of input.lines) {
      if (!l?.order_line_id || typeof l.quantity !== "number" || l.quantity < 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Invalid line item in lines payload`)
      }
      // Bug 5 fix: validate that the order_line_id belongs to this order
      if (!validLineIds.has(l.order_line_id)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Order line ${l.order_line_id} does not belong to order ${input.orderId}`
        )
      }
      deliveredByLine[l.order_line_id] = l.quantity
    }

    // Small tolerance for floating point comparisons (e.g. 4.5 vs 5 rounding)
    const OVER_DELIVERY_TOLERANCE = 0.01

    // #2289 — "already sent" is what the supplier DISPATCHED, which is no
    // longer the receipt ledger: a dispatch posts no receipt. lineLedger takes
    // max(dispatches, receipts), so orders completed before #2289 (receipt
    // rows, no dispatches) keep their history.
    const fulfilledService: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const priorDispatches = await fulfilledService.listInventoryDispatches(
      { inventory_order_id: input.orderId },
      { take: null }
    )
    const dispatchedByLine = sumDispatchedByLine(priorDispatches)

    // Fully fulfilled = every line dispatched in full, counting this payload.
    let fullyFulfilled = true
    const shortages: Array<{ order_line_id: string; requested: number; delivered_cumulative: number; shortage: number }> = []
    const overDeliveries: Array<{ order_line_id: string; requested: number; delivered_cumulative: number; excess: number }> = []
    for (const ol of (order.orderlines ?? []).filter(Boolean)) {
      const lineId = (ol as any).id
      const ledger = lineLedger(ol as any, dispatchedByLine)
      const requested = ledger.ordered
      const thisPayloadDelivered = deliveredByLine[lineId] ?? 0
      const deliveredCumulative = ledger.dispatched + thisPayloadDelivered

      // Bug 1 fix: reject over-delivery beyond tolerance
      if (exceedsOrdered(ledger, thisPayloadDelivered)) {
        overDeliveries.push({
          order_line_id: lineId,
          requested,
          delivered_cumulative: deliveredCumulative,
          excess: thisPayloadDelivered - ledger.to_dispatch,
        })
      }

      if (deliveredCumulative < requested - OVER_DELIVERY_TOLERANCE) {
        fullyFulfilled = false
        shortages.push({
          order_line_id: lineId,
          requested,
          delivered_cumulative: deliveredCumulative,
          shortage: Math.max(0, requested - deliveredCumulative),
        })
      }
    }

    // Bug 6 fix: reject if any lines have over-delivery
    if (overDeliveries.length > 0) {
      const details = overDeliveries
        .map((o) => `line ${o.order_line_id}: requested ${o.requested}, would deliver ${o.delivered_cumulative} (excess ${o.excess.toFixed(2)})`)
        .join("; ")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Over-delivery detected on ${overDeliveries.length} line(s): ${details}`
      )
    }

    // Bug 2 fix: append to history instead of overwriting.
    //
    // 🔴 #2289 — DISPATCH keys, never `partner_delivered_lines` /
    // `partner_delivery_history`. Cancel's stock reversal and the admin Deliver
    // remainder read `partner_delivered_lines` as goods RECEIVED (max with the
    // typed rows). A dispatch written there made cancel reverse stock that was
    // never posted — negative stock. The old keys keep only pre-#2289 data,
    // which really was posted.
    const existingDeliveryHistory = Array.isArray(order.metadata?.partner_dispatch_history)
      ? order.metadata.partner_dispatch_history
      : []
    const deliveryEntry = {
      lines: input.lines,
      notes: input.notes || null,
      delivery_date: input.deliveryDate || null,
      tracking_number: input.trackingNumber || null,
      submitted_at: new Date().toISOString(),
    }

    // Compute metadata patch with delivery info. #778 H3 — no `partner_status`
    // here anymore: the order's `status` column (Shipped/Partial/Delivered set by
    // this workflow's update) is the single source of truth; the metadata copy
    // was write-only drift.
    const completionMetadata = {
      ...(order.metadata || {}),
      // Bug 7 fix: only set partner_completed_at when fully fulfilled
      ...(fullyFulfilled ? { partner_completed_at: new Date().toISOString() } : {}),
      partner_completion_notes: input.notes,
      partner_delivery_date: input.deliveryDate,
      partner_tracking_number: input.trackingNumber,
      partner_dispatched_lines: input.lines,
      partner_dispatch_history: [...existingDeliveryHistory, deliveryEntry],
    }

    const response = { order, completionMetadata, fullyFulfilled, shortages }
    return new StepResponse(response)
  }
)

const updateOrderOnCompletionStep = createStep(
  "partner-complete-update-order",
  async (
    input: { orderId: string; completionMetadata: Record<string, any>; fullyFulfilled: boolean; previousStatus: string; previousMetadata: Record<string, any> },
    { container }
  ) => {
    const scope = container
    const { result, errors } = await updateInventoryOrderWorkflow(scope).run({
      input: {
        id: input.orderId,
        update: {
          status: (input.fullyFulfilled ? "Shipped" : "Partial") as any,
          metadata: input.completionMetadata,
        },
      },
    })

    if (errors && errors.length > 0) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to update inventory order: ${JSON.stringify(errors)}`)
    }

    // Pass rollback data to compensation
    return new StepResponse(result, {
      orderId: input.orderId,
      previousStatus: input.previousStatus,
      previousMetadata: input.previousMetadata,
    })
  },
  async (rollback, { container }) => {
    if (!rollback) return
    try {
      const { result, errors } = await updateInventoryOrderWorkflow(container).run({
        input: {
          id: rollback.orderId,
          update: {
            status: rollback.previousStatus as any,
            metadata: rollback.previousMetadata,
          },
        },
      })
      if (errors && errors.length > 0) {
        console.error("[partner-complete-update-order][compensation] failed to restore order:", JSON.stringify(errors))
      }
    } catch (e) {
      console.error("[partner-complete-update-order][compensation] exception:", e)
    }
  }
)

// Removed direct TaskService-based creation; we'll use createTasksFromTemplatesWorkflow.runAsStep to create

const completeTaskAndSignalIfFulfilledStep = createStep(
  "partner-complete-finish-workflow",
  async (
    input: { orderId: string; fullyFulfilled: boolean; updatedOrder: any },
    { container }
  ) => {
    if (!input.fullyFulfilled) {
      // Keep open; do not complete tasks or signal completion
      return new StepResponse({ signaled: false })
    }

    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const queryService = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    // Get tasks linked to this inventory order
    const shippedTaskLinksResult = await queryService.graph({
      entity: "inventory_orders",
      fields: ["id", "tasks.*"],
      filters: { id: input.orderId },
    })

    const shippedTaskLinks = shippedTaskLinksResult.data || []

    const shippedTaskName = "partner-order-shipped"
    const tasksToUpdate: any[] = []

    for (const orderData of shippedTaskLinks) {
      if (orderData.tasks && Array.isArray(orderData.tasks)) {
        const shippedTasks = orderData.tasks.filter((task: any) => task.title === shippedTaskName && task.status !== "completed")
        tasksToUpdate.push(...shippedTasks)
      }
    }

    if (tasksToUpdate.length > 0) {
      for (const task of tasksToUpdate) {
        await taskService.updateTasks({
          id: task.id,
          status: "completed",
          metadata: {
            ...task.metadata,
            completed_at: new Date().toISOString(),
            completed_by: "partner",
          },
        })
      }
    }

    // Signal the long-running step
    const { errors: stepErrors } = await setInventoryOrderStepSuccessWorkflow(container).run({
      input: {
        stepId: "await-order-completion",
        updatedOrder: input.updatedOrder, // Pass the updated order object directly
      },
    })

    if (stepErrors && stepErrors.length > 0) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to signal workflow: ${JSON.stringify(stepErrors)}`)
    }

    return new StepResponse({ signaled: true })
  }
)

// Step to prepare the update payload, allows richer logic later without deep transform chains
const prepareUpdateInputStep = createStep(
  "partner-complete-prepare-update-input",
  async (
    input: { orderId: string; validated: any },
    _ctx
  ) => {
    const { orderId, validated } = input as any
    const order = validated.order as any
    const payload = {
      orderId,
      completionMetadata: validated.completionMetadata,
      fullyFulfilled: validated.fullyFulfilled,
      // Capture pre-update state for compensation rollback
      previousStatus: String(order.status ?? "Processing"),
      previousMetadata: { ...(order.metadata ?? {}) },
    }
    return new StepResponse(payload)
  }
)

export const partnerCompleteInventoryOrderWorkflow = createWorkflow(
  {
    name: "partner-complete-inventory-order",
    store: true,
  },
  (input: PartnerCompleteInventoryOrderInput) => {
    const validated = validateAndFetchOrderStep(input)

    const prepared = prepareUpdateInputStep({ orderId: input.orderId, validated })

    const updated = updateOrderOnCompletionStep(prepared)

    // #2289 — the supplier's lines are a DISPATCH. No receipt rows, no stock.
    createDispatchEntriesStep({
      orderId: input.orderId,
      partnerId: input.partnerId,
      notes: input.notes,
      deliveryDate: input.deliveryDate,
      trackingNumber: input.trackingNumber,
      lines: input.lines as any,
    })

    // Conditionally create shortage tasks per line when not fully fulfilled, using task workflow
    // Derive a simple boolean gate to avoid deep type comparisons
    const shouldCreateShortageTasks = transform({ v: validated }, ({ v }) => {
      return !v.fullyFulfilled && ((v.shortages?.length ?? 0) > 0)
    })

    when(shouldCreateShortageTasks, (b) => Boolean(b)).then(() => {
      // Derive shortages list
      const shortagesList = transform({ v: validated }, ({ v }) => (v.shortages ?? []))

      // Aggregate shortages for summary metadata
      const totalShortage = transform({ shortagesList }, ({ shortagesList }) =>
        (shortagesList as any[]).reduce((sum, s: any) => sum + (Number(s?.shortage) || 0), 0)
      )

      // Build a single summary task
      const summaryTask = transform({ shortagesList, totalShortage, orderId: input.orderId }, ({ shortagesList, totalShortage, orderId }) => ({
        title: "partner-shortage-summary",
        template_names: ["partner-line-partial"], // reuse existing template; adjust if a dedicated summary template exists
        metadata: {
          workflow_type: "partner_completion",
          type: "shortage_summary",
          order_id: orderId,
          shortages: shortagesList,
          total_shortage: totalShortage,
          created_at: new Date().toISOString(),
        },
      }))

      // Build final input for single task creation
      const taskWorkflowInput = transform({ orderId: input.orderId, summaryTask }, ({ orderId, summaryTask }) => ({
        inventoryOrderId: orderId,
        type: "template",
        ...summaryTask,
      }))

      // Create the partial-completion summary task. NOTE: a try/catch here is
      // ineffective — runAsStep registers a step at composition time, so it
      // cannot swallow a runtime failure. If task creation must be non-blocking,
      // that has to be handled inside the workflow itself.
      createTasksFromTemplatesWorkflow.runAsStep({
        input: taskWorkflowInput as any,
      })
    })

    // #2289 — NO stock posting here. Until 2026-10-08 this block added the
    // supplier's claimed quantities to stock at the destination, on their word,
    // and wrote them as receipts so a lower count could never be recorded.
    // Stock now lands only on a receiver's count (receive-inventory-order).

    completeTaskAndSignalIfFulfilledStep({
      orderId: input.orderId,
      fullyFulfilled: validated.fullyFulfilled,
      updatedOrder: updated,
    })

    return new WorkflowResponse({ success: true, fullyFulfilled: validated.fullyFulfilled })
  }
)
