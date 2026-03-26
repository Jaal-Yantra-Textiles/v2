import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { IInventoryService, LinkDefinition } from "@medusajs/framework/types"
import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import ConsumptionLogService from "../../modules/consumption_log/service"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"

export type LogConsumptionInput = {
  design_id: string
  inventory_item_id: string
  raw_material_id?: string
  quantity: number
  unit_cost?: number
  unit_of_measure?: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other"
  consumption_type?: "sample" | "production" | "wastage"
  consumed_by: "admin" | "partner"
  notes?: string
  location_id?: string
  metadata?: Record<string, any>
}

const validateDesignStep = createStep(
  "log-consumption-validate-design",
  async (input: { design_id: string }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const design = await designService.retrieveDesign(input.design_id)

    if (!design) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${input.design_id} not found`
      )
    }

    return new StepResponse(design)
  }
)

const validateInventoryItemStep = createStep(
  "log-consumption-validate-inventory",
  async (input: { inventory_item_id: string }, { container }) => {
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const item = await inventoryService.retrieveInventoryItem(input.inventory_item_id)

    if (!item) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory item ${input.inventory_item_id} not found`
      )
    }

    return new StepResponse(item)
  }
)

const createConsumptionLogStep = createStep(
  "create-consumption-log",
  async (input: LogConsumptionInput, { container }) => {
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)

    const log = await service.createConsumptionLogs({
      design_id: input.design_id,
      inventory_item_id: input.inventory_item_id,
      raw_material_id: input.raw_material_id || null,
      quantity: input.quantity,
      unit_cost: input.unit_cost ?? null,
      unit_of_measure: input.unit_of_measure || "Other",
      consumption_type: input.consumption_type || "sample",
      is_committed: false,
      consumed_by: input.consumed_by,
      consumed_at: new Date(),
      notes: input.notes || null,
      location_id: input.location_id || null,
      metadata: input.metadata || null,
    })

    return new StepResponse(log, log.id)
  },
  async (logId: string, { container }) => {
    if (!logId) return
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)
    await service.deleteConsumptionLogs(logId)
  }
)

const linkConsumptionLogStep = createStep(
  "link-consumption-log-to-design",
  async (
    input: { design_id: string; inventory_item_id: string; log_id: string },
    { container }
  ) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const designLink: LinkDefinition = {
      [DESIGN_MODULE]: { design_id: input.design_id },
      [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
    }

    const inventoryLink: LinkDefinition = {
      [Modules.INVENTORY]: { inventory_item_id: input.inventory_item_id },
      [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
    }

    await remoteLink.create([designLink, inventoryLink])

    return new StepResponse({ designLink, inventoryLink })
  },
  async (data, { container }) => {
    if (!data) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss([data.designLink, data.inventoryLink])
  }
)

export const logConsumptionWorkflow = createWorkflow(
  {
    name: "log-consumption",
    store: true,
  },
  (input: LogConsumptionInput) => {
    validateDesignStep({ design_id: input.design_id })
    validateInventoryItemStep({ inventory_item_id: input.inventory_item_id })

    const log = createConsumptionLogStep(input)

    const logId = transform({ log }, ({ log }) => log.id) as unknown as string

    linkConsumptionLogStep({
      design_id: input.design_id,
      inventory_item_id: input.inventory_item_id,
      log_id: logId,
    })

    return new WorkflowResponse(log)
  }
)
