import { createWorkflow, createStep, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import type { LinkDefinition } from "@medusajs/framework/types"

// Input type for creating a line fulfillment entry
export type CreateLineFulfillmentInput = {
  orderId: string
  orderLineId: string
  quantityDelta: number
  eventType: "sent" | "shipped" | "received" | "adjust" | "correction"
  notes?: string | null
  metadata?: Record<string, any> | null
}

// Step: validate order and (optionally) line existence
export const validateOrderAndLineStep = createStep(
  "validate-order-and-line-step",
  async (input: CreateLineFulfillmentInput, { container }) => {
    const orderService = container.resolve(ORDER_INVENTORY_MODULE) as any

    // Ensure the inventory order exists. Fetch with minimal select for perf.
    try {
      await orderService.retrieveInventoryOrder(input.orderId, { select: ["id"], relations: ["orderlines"] })
    } catch (e) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory Order ${input.orderId} not found`)
    }

    // If needed, we could verify the line belongs to the order using query.graph in a future iteration.
    return new StepResponse({ ok: true })
  }
)

// Step: create the fulfillment entry in the FULLFILLED_ORDERS_MODULE
export const createFulfillmentEntryStep = createStep(
  "create-fulfillment-entry-step",
  async (input: CreateLineFulfillmentInput, { container, context }) => {
    const service = container.resolve(FULLFILLED_ORDERS_MODULE) as any

    const payload = {
      quantity_delta: input.quantityDelta,
      event_type: input.eventType,
      transaction_id: context.transactionId,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
    }

    const created = await service.createLine_fulfillment(payload)

    // Provide rollback capability: delete the created entry on compensation
    return new StepResponse(created, { deleteId: created.id })
  },
  async (rollbackData, { container }) => {
    if (!rollbackData?.deleteId) return
    const service = container.resolve(FULLFILLED_ORDERS_MODULE) as any
    try {
      await service.deleteLine_fulfillment(rollbackData.deleteId)
    } catch {
      // noop
    }
  }
)

// Step: create module links to connect fulfillment entry with order line and order
export const linkFulfillmentToOrderStep = createStep(
  "link-fulfillment-to-order-step",
  async (
    input: { entryId: string; orderId: string; orderLineId: string },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)

    const links: LinkDefinition[] = [
      {
        [ORDER_INVENTORY_MODULE]: { inventory_order_lines_id: input.orderLineId },
        [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: input.entryId },
      },
      {
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: input.orderId },
        [FULLFILLED_ORDERS_MODULE]: { line_fulfillment_id: input.entryId },
      },
    ]

    const created = await remoteLink.create(links)
    return new StepResponse(created)
  }
)

// Workflow: create line fulfillment entry and link it to order + line
export const createLineFulfillmentWorkflow = createWorkflow(
  {
    name: "create-line-fulfillment",
    // Persist execution as needed
    store: true,
    storeExecution: true,
    retentionTime: 900,
  },
  (input: CreateLineFulfillmentInput) => {
    const validated = validateOrderAndLineStep(input)

    const entry = createFulfillmentEntryStep(input)

    const links = linkFulfillmentToOrderStep({
      entryId: entry.id,
      orderId: input.orderId,
      orderLineId: input.orderLineId,
    })

    return new WorkflowResponse({ entry, links })
  }
)
