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
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"

export type LogConsumptionInput = {
  design_id: string
  production_run_id?: string
  inventory_item_id: string
  raw_material_id?: string
  quantity: number
  unit_cost?: number
  unit_of_measure?:
    | "Meter"
    | "Yard"
    | "Kilogram"
    | "Gram"
    | "Piece"
    | "Roll"
    | "kWh"
    | "Liter"
    | "Cubic_Meter"
    | "Hour"
    | "Other"
  consumption_type?:
    | "sample"
    | "production"
    | "wastage"
    | "energy_electricity"
    | "energy_water"
    | "energy_gas"
    | "labor"
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
      production_run_id: input.production_run_id || null,
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
    input: {
      design_id: string
      production_run_id?: string
      inventory_item_id: string
      log_id: string
    },
    { container }
  ) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const coreLinks: LinkDefinition[] = [
      {
        [DESIGN_MODULE]: { design_id: input.design_id },
        [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
      },
      {
        [Modules.INVENTORY]: { inventory_item_id: input.inventory_item_id },
        [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
      },
    ]

    await remoteLink.create(coreLinks)

    // Production run link is created separately so a failure doesn't
    // break the core design + inventory links
    let productionRunLink: LinkDefinition | null = null
    if (input.production_run_id) {
      productionRunLink = {
        [PRODUCTION_RUNS_MODULE]: {
          production_runs_id: input.production_run_id,
        },
        [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
      }
      try {
        await remoteLink.create([productionRunLink])
      } catch {
        // Link may not be available yet — production_run_id is still
        // stored on the consumption_log record as a direct field
        productionRunLink = null
      }
    }

    return new StepResponse({ coreLinks, productionRunLink })
  },
  async (data, { container }) => {
    if (!data) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(data.coreLinks)
    if (data.productionRunLink) {
      await remoteLink.dismiss([data.productionRunLink]).catch(() => {})
    }
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
      production_run_id: input.production_run_id,
      inventory_item_id: input.inventory_item_id,
      log_id: logId,
    })

    return new WorkflowResponse(log)
  }
)
