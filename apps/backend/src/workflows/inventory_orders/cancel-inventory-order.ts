import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction, UpdateInventoryLevelInput } from "@medusajs/types"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { TASKS_MODULE } from "../../modules/tasks"
import inventoryOrdersTasks from "../../links/inventory-orders-tasks"
import { resolveExistingLevelsStep } from "./partner-complete-inventory-order"
import { updateInventoryOrderWorkflow } from "./update-inventory-order"
import {
  assertCancellable,
  buildReversalLevels,
  computeStockReversalUpdates,
  selectOpenTaskIds,
  type DeliveredLine,
} from "./lib/cancel-helpers"

export type CancelInventoryOrderInput = {
  orderId: string
  /** Free-text reason, persisted to the typed `cancellation_reason` column. */
  reason?: string | null
  /** Actor id (admin user / partner) persisted to `cancelled_by`. */
  cancelledBy?: string | null
  /** Optional explicit reversal location; otherwise resolved off the order. */
  stockLocationId?: string | null
}

/**
 * Load the order for cancellation: guard existence (a real array check — not the
 * broken truthy-array check the delete path had, #778 H11) and the cancel
 * transition, and surface the delivered lines + destination location needed to
 * reverse posted stock.
 */
export const loadOrderForCancelStep = createStep(
  "load-inventory-order-for-cancel",
  async (input: CancelInventoryOrderInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const { data } = await query.graph({
      entity: "inventory_orders",
      filters: { id: input.orderId },
      fields: [
        "id",
        "status",
        "metadata",
        "orderlines.id",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.stock_locations.id",
        "stock_locations.id",
      ],
    })

    const order = data?.[0] as any
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory order ${input.orderId} not found`
      )
    }
    assertCancellable(order.status)

    const deliveredLines = (order.metadata?.partner_delivered_lines || []) as DeliveredLine[]
    const destLocationId =
      input.stockLocationId ||
      order.to_stock_location_id ||
      order.stock_location_id ||
      order.destination_stock_location_id ||
      order.stock_locations?.[0]?.id ||
      null

    return new StepResponse({
      order,
      orderlines: order.orderlines || [],
      deliveredLines,
      destLocationId,
    })
  }
)

/**
 * Cancel every still-open task linked to the order (leaves completed/cancelled
 * tasks untouched). Best-effort: a task-cleanup failure must not block the
 * cancellation itself.
 */
export const cancelOpenInventoryOrderTasksStep = createStep(
  "cancel-open-inventory-order-tasks",
  async (input: { orderId: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const taskService: any = container.resolve(TASKS_MODULE)

    let openTaskIds: string[] = []
    try {
      const { data } = await query.graph({
        entity: inventoryOrdersTasks.entryPoint,
        filters: { inventory_orders_id: input.orderId },
        fields: ["task.id", "task.status"],
      })
      const tasks = (data || []).map((row: any) => row.task)
      openTaskIds = selectOpenTaskIds(tasks)
      if (openTaskIds.length > 0) {
        await taskService.updateTasks(
          openTaskIds.map((id) => ({ id, status: "cancelled" }))
        )
      }
    } catch {
      /* best-effort — never block the cancellation on task cleanup */
    }

    return new StepResponse({ cancelledTaskIds: openTaskIds })
  }
)

/**
 * Cancel an inventory order (#778 C2/C4): reverse any stock prior deliveries
 * posted, cancel open tasks, flip the status to Cancelled (stamping the
 * cancellation audit columns), and — via the reused update workflow — emit the
 * status-changed event and mirror the cancel onto the unified core order.
 */
export const cancelInventoryOrderWorkflow = createWorkflow(
  {
    name: "cancel-inventory-order",
    store: true,
  },
  (input: CancelInventoryOrderInput) => {
    const loaded = loadOrderForCancelStep(input)

    // Resolve which (item, location, qty) levels need reversing, then look up
    // the existing levels so we know their ids + current quantities.
    const reversalLevels = transform({ loaded }, ({ loaded }) =>
      buildReversalLevels(loaded.orderlines, loaded.deliveredLines, loaded.destLocationId)
    )
    const levelsForLookup = transform({ reversalLevels }, ({ reversalLevels }) =>
      (reversalLevels as any[]).map((r) => ({
        location_id: r.location_id,
        inventory_item_id: r.inventory_item_id,
        stocked_quantity: r.quantity,
      }))
    )
    const resolved = resolveExistingLevelsStep({ levels: levelsForLookup as any }) as any
    const existing = transform({ resolved }, ({ resolved }) => resolved?.existing || [])

    const updates = transform(
      { reversalLevels, existing },
      ({ reversalLevels, existing }) =>
        computeStockReversalUpdates(reversalLevels as any[], existing as any[])
    )
    const hasUpdates = transform({ updates }, ({ updates }) => Array.isArray(updates) && (updates as any[]).length > 0)

    when(hasUpdates, (b) => Boolean(b)).then(() => {
      updateInventoryLevelsWorkflow.runAsStep({
        input: { updates: updates as unknown as UpdateInventoryLevelInput[] },
      })
    })

    cancelOpenInventoryOrderTasksStep({ orderId: input.orderId })

    // Flip status + stamp audit columns, reusing the update workflow so the
    // status-changed event (#771) and unified-order mirror (Cancelled→canceled)
    // fire for free.
    const updateInput = transform({ input }, ({ input }) => ({
      id: input.orderId,
      update: {
        status: "Cancelled" as const,
        cancelled_at: new Date(),
        cancellation_reason: input.reason ?? null,
        cancelled_by: input.cancelledBy ?? null,
      },
    }))
    updateInventoryOrderWorkflow.runAsStep({ input: updateInput })

    return new WorkflowResponse(transform({ loaded, updates }, ({ loaded, updates }) => ({
      success: true,
      orderId: loaded.order.id,
      reversedLevels: (updates as any[]).length,
    })))
  }
)
