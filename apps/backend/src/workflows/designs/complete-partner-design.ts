import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse, when, transform } from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"
import TaskService from "../../modules/tasks/service"
import { TASKS_MODULE } from "../../modules/tasks"
import { IInventoryService, IWorkflowEngineService } from "@medusajs/types"
import { LinkDefinition } from "@medusajs/framework/types"
import { sendDesignToPartnerWorkflow } from "./send-to-partner"

export type ConsumptionInput = {
  inventory_item_id: string
  quantity?: number
  location_id?: string
}

export type CompletePartnerDesignInput = {
  design_id: string
  consumptions?: ConsumptionInput[]
}

const assertAssignmentNotCancelledStep = createStep(
  "complete-design-assert-not-cancelled",
  async (input: { design_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "designs",
      fields: ["metadata"],
      filters: { id: input.design_id },
    })
    if (data?.[0]?.metadata?.partner_assignment_cancelled_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This design assignment has been cancelled"
      )
    }
    return new StepResponse({ ok: true })
  }
)

// Tolerant best-effort signal to a sendDesignToPartner workflow gate. Swallows
// all engine errors — gates like await-design-redo/refinish are expected to be
// absent for happy-path completions. Each gate gets its own uniquely-named step
// instance because Medusa's workflow SDK disallows invoking the same step
// object twice in one workflow body.
const makeSoftSignalStep = (
  stepName: string,
  gateId: string,
  kind: "success" | "failed"
) =>
  createStep(
    stepName,
    async (
      input: { design_id: string; updatedDesign: any },
      { container }
    ) => {
      const engineService: IWorkflowEngineService = container.resolve(
        Modules.WORKFLOW_ENGINE
      )
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      try {
        const taskLinksResult = await query.graph({
          entity: "designs",
          fields: ["id", "tasks.*"],
          filters: { id: input.design_id },
        })

        const txCandidates: any[] = []
        for (const design of taskLinksResult.data || []) {
          for (const task of (design as any).tasks || []) {
            if (task?.transaction_id) txCandidates.push(task)
          }
        }
        if (!txCandidates.length) return new StepResponse({ signaled: false })

        txCandidates.sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )
        const workflowTransactionId = txCandidates[0].transaction_id

        const updatedDesign = Array.isArray(input.updatedDesign)
          ? input.updatedDesign[0]
          : input.updatedDesign
        const targetId = updatedDesign?.id || input.design_id

        const idempotencyKey = {
          action: TransactionHandlerType.INVOKE,
          transactionId: workflowTransactionId,
          stepId: gateId,
          workflowId: sendDesignToPartnerWorkflow.getName(),
        }
        const stepResponse = new StepResponse(updatedDesign, targetId)
        if (kind === "success") {
          await engineService.setStepSuccess({ idempotencyKey, stepResponse })
        } else {
          await engineService.setStepFailure({ idempotencyKey, stepResponse })
        }
        return new StepResponse({ signaled: true })
      } catch {
        return new StepResponse({ signaled: false })
      }
    }
  )

const signalAwaitDesignInventoryStep = makeSoftSignalStep(
  "complete-design-signal-await-inventory",
  "await-design-inventory",
  "success"
)
const signalAwaitDesignRedoStep = makeSoftSignalStep(
  "complete-design-signal-await-redo",
  "await-design-redo",
  "failed"
)
const signalAwaitDesignRefinishStep = makeSoftSignalStep(
  "complete-design-signal-await-refinish",
  "await-design-refinish",
  "failed"
)
const signalAwaitDesignCompletedStep = makeSoftSignalStep(
  "complete-design-signal-await-completed",
  "await-design-completed",
  "success"
)

const validateAndFetchDesignStep = createStep(
  "complete-design-validate-and-fetch",
  async (input: CompletePartnerDesignInput, { container }) => {
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "designs",
      fields: [
        "*",
        // fetch linked inventory items and their stock locations via link
        "inventory_items.*",
        "inventory_items.location_levels.*",
        "inventory_items.location_levels.stock_locations.*",
        // bring in tasks for later status update
        "tasks.*",
      ],
      filters: { id: input.design_id },
    })
    if (!Array.isArray(data) || !data.length) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${input.design_id} not found`)
    }
    return new StepResponse(data[0])
  }
)

const computeAdjustmentsStep = createStep(
  "complete-design-compute-adjustments",
  async (
    input: { design: any; consumptions?: ConsumptionInput[] },
  ) => {
    const design = input.design || {}
    const linkedItems: any[] = Array.isArray(design.inventory_items) ? design.inventory_items : []

    // Build a map for quick lookup of item -> first location id (via location_levels)
    const defaultLocByItem: Record<string, string | undefined> = {}
    const linkedItemIds = new Set<string>()
    for (const it of linkedItems) {
      const levels = (it?.location_levels || []) as any[]
      const loc = levels?.[0]?.stock_locations?.[0]
      defaultLocByItem[String(it.id)] = loc?.id
      linkedItemIds.add(String(it.id))
    }

    const adjustments: Array<{ inventoryItemId: string; locationId: string; adjustment: number }> = []

    if (Array.isArray(input.consumptions) && input.consumptions.length) {
      for (const c of input.consumptions) {
        const qty = Math.abs(Number(c.quantity ?? 1))
        const itemId = String(c.inventory_item_id)
        if (!linkedItemIds.has(itemId)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, `Inventory item ${itemId} is not linked to this design`)
        }
        const loc = c.location_id || defaultLocByItem[itemId]
        if (!loc) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, `No stock location found for inventory item ${itemId}. Please link a stock location or provide location_id`)
        }
        adjustments.push({ inventoryItemId: c.inventory_item_id, locationId: String(loc), adjustment: -qty })
      }
    } else {
      // Default: decrement 1 for each linked inventory item at its first location
      for (const it of linkedItems) {
        const itemId = String(it.id)
        const loc = defaultLocByItem[itemId]
        if (!loc) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, `No stock location found for inventory item ${itemId}. Please link a stock location or provide consumptions with location_id`)
        }
        adjustments.push({ inventoryItemId: itemId, locationId: String(loc), adjustment: -1 })
      }
    }

    return new StepResponse(adjustments)
  }
)

const adjustInventoryStep = createStep(
  "complete-design-adjust-inventory",
  async (input: { adjustments: Array<{ inventoryItemId: string; locationId: string; adjustment: number }> }, { container }) => {
    if (!Array.isArray(input.adjustments) || !input.adjustments.length) {
      return new StepResponse({ count: 0 })
    }
    const inventoryService:IInventoryService = container.resolve(Modules.INVENTORY)
    await inventoryService.adjustInventory(input.adjustments)
    return new StepResponse({ count: input.adjustments.length })
  }
)

const recordInventoryConsumptionStep = createStep(
  "complete-design-record-consumption",
  async (
    input: { designId: string; adjustments: Array<{ inventoryItemId: string; locationId: string; adjustment: number }> },
    { container, context },
  ) => {
    if (!Array.isArray(input.adjustments) || !input.adjustments.length) {
      return new StepResponse({ updated: 0 })
    }
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    const consumedAt = new Date()
    const transactionId = context.transactionId
    const links: LinkDefinition[] = input.adjustments
      .filter((adj) => adj?.inventoryItemId)
      .map((adj) => ({
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
        [Modules.INVENTORY]: {
          inventory_item_id: adj.inventoryItemId,
        },
        data: {
          consumed_quantity: Math.abs(adj.adjustment),
          consumed_at: consumedAt,
          location_id: adj.locationId,
          metadata: {
            ...(transactionId ? { transaction_id: transactionId } : {}),
            source: "complete-partner-design",
          },
        },
      }))
    if (!links.length) {
      return new StepResponse({ updated: 0 })
    }
    await remoteLink.create(links)
    return new StepResponse({ updated: links.length })
  },
)

const updateDesignStatusStep = createStep(
  "complete-design-update-status",
  async (input: { designId: string }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const updated = await designService.updateDesigns({
      id: input.designId,
      status: "Approved" as any,
      metadata: {
        partner_completed_at: new Date().toISOString(),
        partner_status: "completed",
      },
    })
    return new StepResponse(updated)
  }
)

const completeDesignTasksStep = createStep(
  "complete-design-complete-tasks",
  async (input: { tasks: any[] }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const tasks = input.tasks || []
    const toComplete = tasks.filter((t: any) => t?.title === "partner-design-completed" && t?.status !== "completed")
    for (const t of toComplete) {
      await taskService.updateTasks({
        id: t.id,
        status: "completed",
        metadata: { ...(t.metadata || {}), completed_at: new Date().toISOString(), completed_by: "partner" },
      })
    }
    // Cancel redo-related tasks if present and not completed
    const redoTitles = new Set(["partner-design-redo", "partner-design-redo-log", "partner-design-redo-apply", "partner-design-redo-verify"])
    const redoPending = tasks.filter((t: any) => redoTitles.has(t?.title) && t?.status !== "completed")
    for (const t of redoPending) {
      await taskService.updateTasks({
        id: t.id,
        status: "cancelled",
        metadata: { ...(t.metadata || {}), cancelled_at: new Date().toISOString(), cancelled_by: "system" },
      })
    }
    return new StepResponse({ completed: toComplete.length, cancelled: redoPending.length })
  }
)

export const completePartnerDesignWorkflow = createWorkflow(
  {
    name: "complete-partner-design",
    store: true,
  },
  (input: CompletePartnerDesignInput) => {
    assertAssignmentNotCancelledStep({ design_id: input.design_id })

    const design = validateAndFetchDesignStep(input)

    const adjustments = computeAdjustmentsStep({ design, consumptions: input.consumptions })

    const adjResult = adjustInventoryStep({ adjustments }) as any

    const consumptionRecord = recordInventoryConsumptionStep({ designId: input.design_id, adjustments })

    const updatedDesign = updateDesignStatusStep({ designId: input.design_id }) as any

    const taskResult = completeDesignTasksStep({ tasks: (design as any).tasks || [] }) as any

    // Best-effort sendDesignToPartner gate signaling. Each call is tolerant —
    // missing gates (redo/refinish in happy path) are expected.
    signalAwaitDesignInventoryStep({ design_id: input.design_id, updatedDesign })
    signalAwaitDesignRedoStep({ design_id: input.design_id, updatedDesign })
    signalAwaitDesignRefinishStep({ design_id: input.design_id, updatedDesign })
    signalAwaitDesignCompletedStep({ design_id: input.design_id, updatedDesign })

    return new WorkflowResponse({
      success: true,
      updatedDesign,
      adjustments: adjResult,
      tasks: taskResult,
      consumption: consumptionRecord,
    })
  }
)
