import { createStep, createWorkflow, StepResponse, WorkflowResponse, when, transform } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { TASKS_MODULE } from "../../modules/tasks";
import { createTasksFromTemplatesWorkflow } from "./create-tasks-from-templates";
import { updateInventoryOrderWorkflow } from "./update-inventory-order";
import { setInventoryOrderStepSuccessWorkflow } from "./inventory-order-steps";
import TaskService from "../../modules/tasks/service";
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";
import Fullfilled_ordersService from "../../modules/fullfilled_orders/service";

export type PartnerCompleteOrderLine = {
  order_line_id: string
  quantity: number
}

export type PartnerCompleteInventoryOrderInput = {
  orderId: string
  notes?: string
  deliveryDate?: string
  trackingNumber?: string
  lines: PartnerCompleteOrderLine[]
}

// Step: prepare fulfillment payloads (filters happen inside the step)

// Debug step: logs partial completion context at execution time
const debugPartialCompletionStep = createStep(
  "partner-complete-debug-partial",
  async (
    input: { orderId: string; shortages: Array<{ orderLineId?: string; shortage?: number }>; transactionId?: string },
    { context }
  ) => {
    try {
      const shortages = Array.isArray(input.shortages) ? input.shortages : []
      const compact = shortages.map((s: any) => ({ line: s.orderLineId || s.order_line_id, shortage: s.shortage }))
    } catch (e) {
    }
    return new StepResponse(null)
  }
)
const prepareFulfillmentPayloadsStep = createStep(
  "partner-complete-prepare-fulfillment-payloads",
  async (
    input: { orderId: string; notes?: string; deliveryDate?: string; trackingNumber?: string; lines: Array<{ order_line_id: string; quantity: number }> },
  ) => {
    const safeLines = Array.isArray(input.lines) ? input.lines : []
    const payloads = safeLines
      .filter((l) => l && typeof l.quantity === "number" && l.quantity !== 0)
      .map((l) => ({
        orderId: input.orderId,
        orderLineId: l.order_line_id,
        quantityDelta: l.quantity,
        eventType: "received" as const,
        notes: input.notes ?? undefined,
        metadata: {
          workflow_type: "partner_completion",
          delivery_date: input.deliveryDate ?? null,
          tracking_number: input.trackingNumber ?? null,
          source: "partner-complete-inventory-order",
        } as Record<string, any>,
      }))

    return new StepResponse(payloads)
  }
)

// Step: create fulfillment entries and links from prepared payloads (single step encapsulation)
const createFulfillmentEntriesStep = createStep(
  "partner-complete-create-fulfillment-entries",
  async (
    input: { payloads: Array<{ orderId: string; orderLineId: string; quantityDelta: number; eventType: "received" | "sent" | "shipped" | "adjust" | "correction"; notes?: string | undefined; metadata: Record<string, any> }> },
    { container, context }
  ) => {
    const service: Fullfilled_ordersService = container.resolve(FULLFILLED_ORDERS_MODULE) as any
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)

    const createdIds: string[] = []
    for (const p of (input.payloads || [])) {
      const entry = await service.createLine_fulfillments({
        quantity_delta: p.quantityDelta,
        event_type: p.eventType,
        transaction_id: context.transactionId,
        notes: p.notes ?? undefined,
        metadata: p.metadata,
      })
      createdIds.push(entry.id)

      await remoteLink.create([
        {
          [ORDER_INVENTORY_MODULE]: { inventory_order_line_id: p.orderLineId },
          [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: entry.id },
        },
        {
          [ORDER_INVENTORY_MODULE]: { inventory_orders_id: p.orderId },
          [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: entry.id },
        },
      ])
    }

    return new StepResponse({ count: createdIds.length, ids: createdIds }, { ids: createdIds })
  },
  async (rb, { container }) => {
    if (!rb?.ids?.length) return
    const service: Fullfilled_ordersService = container.resolve("fullfilled_orders") as any
    for (const id of rb.ids as string[]) {
      try { await service.deleteLine_fulfillments(id) } catch {}
    }
  }
)

const validateAndFetchOrderStep = createStep(
  "partner-complete-validate-and-fetch-order",
  async (input: PartnerCompleteInventoryOrderInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "*",
        "orderlines.*",
        // include existing fulfillments to compute cumulative delivered qty
        "orderlines.line_fulfillments.quantity_delta",
      ],
      filters: { id: input.orderId },
    })

    if (!orders || orders.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.orderId} not found`)
    }

    const order = orders[0]

    // Allow Processing or Partial for subsequent partial deliveries (lint-safe cast)
    if (!(((order as any).status === "Processing") || ((order as any).status === "Partial"))) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${input.orderId} not in an updatable state (status: ${order.status})`)
    }

    if (order.metadata?.partner_status !== "started" && order.metadata?.partner_status !== "partial") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${input.orderId} is not in started state`)
    }

    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `lines must be a non-empty array`)
    }

    // Build easy lookup for delivered quantities
    const deliveredByLine: Record<string, number> = {}
    for (const l of input.lines) {
      if (!l?.order_line_id || typeof l.quantity !== "number" || l.quantity < 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Invalid line item in lines payload`)
      }
      deliveredByLine[l.order_line_id] = l.quantity
    }

    // Determine if fully fulfilled cumulatively: requested <= (existing delivered + this payload)
    // If any line cumulative is less than requested, keep open
    let fullyFulfilled = true
    const shortages: Array<{ order_line_id: string; requested: number; delivered_cumulative: number; shortage: number }> = []
    for (const ol of (order.orderlines ?? []).filter(Boolean)) {
      const lineId = (ol as any).id
      const requested = Number((ol as any).quantity ?? 0) || 0
      const existingDelivered = ((ol as any).line_fulfillments || []).reduce(
        (s: number, f: any) => s + (Number(f?.quantity_delta) || 0),
        0
      )
      const thisPayloadDelivered = deliveredByLine[lineId] ?? 0
      const deliveredCumulative = existingDelivered + thisPayloadDelivered
      if (deliveredCumulative < requested) {
        fullyFulfilled = false
        shortages.push({
          order_line_id: lineId,
          requested,
          delivered_cumulative: deliveredCumulative,
          shortage: Math.max(0, requested - deliveredCumulative),
        })
      }
    }

    // Compute metadata patch with delivery info
    const completionMetadata = {
      ...(order.metadata || {}),
      partner_completed_at: new Date().toISOString(),
      partner_status: fullyFulfilled ? "completed" : "partial",
      partner_completion_notes: input.notes,
      partner_delivery_date: input.deliveryDate,
      partner_tracking_number: input.trackingNumber,
      partner_delivered_lines: input.lines, // store business data on order metadata
    }

    const response = { order, completionMetadata, fullyFulfilled, shortages }
    return new StepResponse(response)
  }
)

const updateOrderOnCompletionStep = createStep(
  "partner-complete-update-order",
  async (
    input: { orderId: string; completionMetadata: Record<string, any>; fullyFulfilled: boolean },
    { container }
  ) => {
    // Use the existing update workflow like in the route
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

    return new StepResponse(result)
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
    const queryService = container.resolve(ContainerRegistrationKeys.QUERY)

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
    const payload = {
      orderId,
      completionMetadata: validated.completionMetadata,
      fullyFulfilled: validated.fullyFulfilled,
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

    // Prepare fulfillment payloads in a step (filters inside the step)
    const fulfillmentPayloads = prepareFulfillmentPayloadsStep({
      orderId: input.orderId,
      notes: input.notes,
      deliveryDate: input.deliveryDate,
      trackingNumber: input.trackingNumber,
      lines: input.lines as any,
    })

    // Only create entries when we have payloads
    const shouldWriteFulfillmentEntries = transform({ payloads: fulfillmentPayloads as any }, ({ payloads }) => {
      const arr = (payloads as unknown as any[]) || []
      return Array.isArray(arr) && arr.length > 0
    })

    when(shouldWriteFulfillmentEntries, (b) => Boolean(b)).then(() => {
      createFulfillmentEntriesStep({ payloads: fulfillmentPayloads as unknown as any })
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

      // Protect API from being blocked by task creation issues in partial path
      try {
        createTasksFromTemplatesWorkflow.runAsStep({
          input: taskWorkflowInput as any,
        })
      } catch (e) {
      }

      // Additional focused debug log for partial completion
      debugPartialCompletionStep({
        orderId: input.orderId,
        shortages: shortagesList as unknown as any[],
      })
    })

    completeTaskAndSignalIfFulfilledStep({
      orderId: input.orderId,
      fullyFulfilled: validated.fullyFulfilled,
      updatedOrder: updated,
    })

    return new WorkflowResponse({ success: true, fullyFulfilled: validated.fullyFulfilled })
  }
)
