/**
 * Shared workflow steps for partner production run actions (start, finish, complete).
 *
 * These replace the inline route logic that previously violated the
 * Module → Workflow → API Route architecture pattern.
 */
import { ContainerRegistrationKeys, MedusaError, Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { TASKS_MODULE } from "../../modules/tasks"
import { lifecycleWorkflowId } from "./run-production-run-lifecycle"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartnerRunInput = {
  production_run_id: string
  partner_id: string
}

export type ResolvedPartnerLocation = {
  location_id: string | undefined
}

// ---------------------------------------------------------------------------
// Step: Retrieve & validate ownership + status
// ---------------------------------------------------------------------------

export type ValidateRunOpts = {
  /** Which statuses the run must be in */
  allowedStatuses: string[]
  /** If true, run.started_at must be set */
  requireStarted?: boolean
  /** If true, run.finished_at must be set */
  requireFinished?: boolean
  /** Human-readable action name for error messages */
  action: string
}

export const retrieveAndValidatePartnerRunStep = createStep(
  "retrieve-and-validate-partner-run",
  async (
    input: PartnerRunInput & { opts: ValidateRunOpts },
    { container }
  ) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)

    const run = await productionRunService
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)

    if (!run || (run as any).partner_id !== input.partner_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }

    const status = String((run as any).status)
    if (!input.opts.allowedStatuses.includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be ${input.opts.allowedStatuses.join(" or ")} to ${input.opts.action}. Current status: ${status}`
      )
    }

    if (input.opts.requireStarted && !(run as any).started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be started before it can be ${input.opts.action}ed`
      )
    }

    if (input.opts.requireFinished && !(run as any).finished_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Production run must be finished before it can be ${input.opts.action}d`
      )
    }

    // Guard against double-start
    if (input.opts.action === "start" && (run as any).started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Production run has already been started"
      )
    }

    return new StepResponse(run)
  }
)

// ---------------------------------------------------------------------------
// Step: Transition design status (guarded)
// ---------------------------------------------------------------------------

export type TransitionDesignInput = {
  design_id: string | null
  target_status: string
  skip_statuses: string[]
}

export const transitionDesignStatusStep = createStep(
  "transition-design-status",
  async (input: TransitionDesignInput, { container }) => {
    if (!input.design_id) {
      return new StepResponse(
        { previous_status: null as string | null, skipped: true },
        null as { design_id: string; previous_status: string } | null
      )
    }

    const designService = container.resolve("design") as any
    const design = await designService.retrieveDesign(input.design_id)

    if (input.skip_statuses.includes(design.status)) {
      return new StepResponse(
        { previous_status: design.status as string | null, skipped: true },
        null as { design_id: string; previous_status: string } | null
      )
    }

    const previousStatus = design.status
    await designService.updateDesigns({
      id: input.design_id,
      status: input.target_status,
    })

    return new StepResponse(
      { previous_status: previousStatus as string | null, skipped: false },
      { design_id: input.design_id, previous_status: previousStatus } as { design_id: string; previous_status: string } | null
    )
  },
  // Compensation: restore previous design status
  async (rollbackData: { design_id: string; previous_status: string } | null, { container }) => {
    if (!rollbackData?.design_id) return
    const designService = container.resolve("design") as any
    await designService.updateDesigns({
      id: rollbackData.design_id,
      status: rollbackData.previous_status,
    })
  }
)

// ---------------------------------------------------------------------------
// Step: Signal lifecycle workflow step
// ---------------------------------------------------------------------------

export type SignalLifecycleInput = {
  lifecycle_transaction_id: string | null
  step_id: string
}

export const signalLifecycleStepStep = createStep(
  "signal-lifecycle-step",
  async (input: SignalLifecycleInput, { container }) => {
    if (!input.lifecycle_transaction_id) {
      return new StepResponse({ signaled: false })
    }

    const engineService = container.resolve(Modules.WORKFLOW_ENGINE) as any

    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: input.lifecycle_transaction_id,
          stepId: input.step_id,
          workflowId: lifecycleWorkflowId,
        },
        stepResponse: new StepResponse(true),
      })
    } catch (e: any) {
      // Step may already be completed — safe to ignore
      if (!String(e?.message || "").includes("status is ok")) {
        throw e
      }
    }

    return new StepResponse({ signaled: true })
  }
)

// ---------------------------------------------------------------------------
// Step: Emit production run event
// ---------------------------------------------------------------------------

export type EmitRunEventInput = {
  event_name: string
  data: Record<string, any>
}

export const emitProductionRunEventStep = createStep(
  "emit-production-run-event",
  async (input: EmitRunEventInput, { container }) => {
    const eventService = container.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{ name: input.event_name, data: input.data }])
    return new StepResponse({ emitted: true })
  }
)

// ---------------------------------------------------------------------------
// Step: Resolve partner's default stock location
// ---------------------------------------------------------------------------

export const resolvePartnerLocationStep = createStep(
  "resolve-partner-location",
  async (input: { partner_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    let locationId: string | undefined

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["stores.default_sales_channel_id"],
      filters: { id: input.partner_id },
    })

    const scId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
    if (scId) {
      const { data: channels } = await query.graph({
        entity: "sales_channels",
        fields: ["stock_locations.id"],
        filters: { id: scId },
      })
      locationId = channels?.[0]?.stock_locations?.[0]?.id
    }

    return new StepResponse({ location_id: locationId })
  }
)

// ---------------------------------------------------------------------------
// Step: Complete linked tasks
// ---------------------------------------------------------------------------

export const completeLinkedTasksStep = createStep(
  "complete-linked-tasks",
  async (input: { production_run_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const taskService = container.resolve(TASKS_MODULE) as any

    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["id", "tasks.id", "tasks.status", "tasks.title"],
      filters: { id: input.production_run_id },
    })

    const linkedTasks = ((runData?.[0] as any)?.tasks || []) as any[]
    const pendingTasks = linkedTasks.filter(
      (t: any) =>
        t?.id && !["completed", "cancelled"].includes(String(t.status || ""))
    )

    const completedTaskIds: string[] = []
    for (const t of pendingTasks) {
      await taskService.updateTasks({ id: t.id, status: "completed" })
      completedTaskIds.push(t.id)
    }

    return new StepResponse(
      { completed_count: completedTaskIds.length },
      { task_ids: completedTaskIds }
    )
  },
  // Compensation: restore tasks to in_progress
  async (rollbackData, { container }) => {
    if (!rollbackData?.task_ids?.length) return
    const taskService = container.resolve(TASKS_MODULE) as any
    for (const taskId of rollbackData.task_ids) {
      await taskService
        .updateTasks({ id: taskId, status: "in_progress" })
        .catch(() => {})
    }
  }
)

// ---------------------------------------------------------------------------
// Step: Stock finished goods at partner location
// ---------------------------------------------------------------------------

export type StockFinishedGoodsInput = {
  production_run_id: string
  design_id: string
  partner_id: string
  good_quantity: number
  location_id: string | undefined
  order_id: string | null
  order_line_item_id: string | null
  run_quantity: number
}

type StockRollbackData = {
  inventory_item_id: string
  location_id: string
  quantity: number
} | null

export const stockFinishedGoodsStep = createStep(
  "stock-finished-goods",
  async (input: StockFinishedGoodsInput, { container }) => {
    if (input.good_quantity <= 0 || !input.location_id) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const inventoryService = container.resolve(Modules.INVENTORY) as any

    // Resolve design → variant → inventory item
    const { data: designVariants } = await query.graph({
      entity: "design_product_variant",
      filters: { design_id: input.design_id },
      fields: ["product_variant_id"],
    })

    const variantId = designVariants?.[0]?.product_variant_id
    if (!variantId) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    const { data: variantInventory } = await query.graph({
      entity: "product_variant_inventory_item",
      filters: { variant_id: variantId },
      fields: ["inventory_item_id"],
    })

    const inventoryItemId = variantInventory?.[0]?.inventory_item_id
    if (!inventoryItemId) {
      return new StepResponse({ stocked: false }, null as StockRollbackData)
    }

    // Upsert inventory level
    const [existingLevel] = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: input.location_id,
    })

    if (existingLevel) {
      await inventoryService.updateInventoryLevels(existingLevel.id, {
        stocked_quantity: (existingLevel.stocked_quantity || 0) + input.good_quantity,
      })
    } else {
      await inventoryService.createInventoryLevels({
        inventory_item_id: inventoryItemId,
        location_id: input.location_id,
        stocked_quantity: input.good_quantity,
      })
    }

    // Create reservation for the order if linked
    if (input.order_id) {
      let lineItemId = input.order_line_item_id
      if (!lineItemId) {
        const { data: orders } = await query.graph({
          entity: "order",
          filters: { id: input.order_id },
          fields: ["items.*"],
        })
        const items = orders?.[0]?.items || []
        const designItem = items.find(
          (i: any) => i.metadata?.design_id === input.design_id && i.variant_id === variantId
        )
        lineItemId = designItem?.id
      }

      if (lineItemId) {
        await inventoryService.createReservationItems({
          inventory_item_id: inventoryItemId,
          location_id: input.location_id,
          quantity: Math.min(input.good_quantity, input.run_quantity || input.good_quantity),
          line_item_id: lineItemId,
          description: `Reserved for order ${input.order_id} from production run ${input.production_run_id}`,
          metadata: {
            production_run_id: input.production_run_id,
            order_id: input.order_id,
          },
        })
      }
    }

    return new StepResponse(
      { stocked: true },
      { inventory_item_id: inventoryItemId, location_id: input.location_id, quantity: input.good_quantity } as StockRollbackData
    )
  },
  // Compensation: remove the stocked quantity
  async (rollbackData: StockRollbackData, { container }) => {
    if (!rollbackData?.inventory_item_id) return
    const inventoryService = container.resolve(Modules.INVENTORY) as any
    const [level] = await inventoryService.listInventoryLevels({
      inventory_item_id: rollbackData.inventory_item_id,
      location_id: rollbackData.location_id,
    })
    if (level) {
      await inventoryService.updateInventoryLevels(level.id, {
        stocked_quantity: Math.max(0, (level.stocked_quantity || 0) - rollbackData.quantity),
      }).catch(() => {})
    }
  }
)
