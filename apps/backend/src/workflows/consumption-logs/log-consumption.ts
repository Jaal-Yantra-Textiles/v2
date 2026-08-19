import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { IInventoryService, LinkDefinition } from "@medusajs/framework/types"
import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import ConsumptionLogService from "../../modules/consumption_log/service"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import {
  allocationLabels,
  readRunAllocation,
} from "../../lib/production-run-allocation"
import { checkConsumptionAgainstAllocation } from "../production-runs/lib/run-materials"

// Energy/labor consumption types that don't require an inventory item
const NON_INVENTORY_TYPES = ["energy_electricity", "energy_water", "energy_gas", "labor"]

export type LogConsumptionInput = {
  design_id: string
  production_run_id?: string
  inventory_item_id?: string
  raw_material_id?: string
  quantity: number
  /** What `quantity` measures — see the model. */
  quantity_basis?: "total" | "per_piece" | null
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

/**
 * A run may only consume what it was assigned.
 *
 * Deliberately here in the WORKFLOW rather than on the partner route: three
 * routes reach this workflow (partner run, partner design, admin design) and a
 * guard on one path is not a guard — #1314 refused loudly on the manual path
 * while the automatic one went through silently. Every consumption that names a
 * production run passes through this step.
 *
 * Runs to completion BEFORE the log row is created, so a refusal writes nothing.
 *
 * Silent on runs with no allocation, which is every run made before this
 * existed. See run-materials.ts — absence is "nobody chose", not "chose
 * nothing", and treating them alike would 400 the entire existing floor.
 */
const assertConsumptionWithinAllocationStep = createStep(
  "log-consumption-assert-within-allocation",
  async (
    input: { production_run_id: string; inventory_item_id: string },
    { container }
  ) => {
    const allocation = await readRunAllocation(container, input.production_run_id)

    const verdict = checkConsumptionAgainstAllocation({
      allocatedInventoryItemIds: allocation.map((a) => a.inventory_item_id),
      inventoryItemId: input.inventory_item_id,
      labelsById: allocationLabels(allocation),
    })

    if (!verdict.allowed) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, verdict.reason)
    }

    return new StepResponse({ constrained: verdict.constrained })
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
      quantity_basis: input.quantity_basis ?? null,
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
      has_inventory?: boolean
    },
    { container }
  ) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const coreLinks: LinkDefinition[] = [
      {
        [DESIGN_MODULE]: { design_id: input.design_id },
        [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
      },
    ]

    // Only link to inventory if this is a material-type consumption
    if (input.has_inventory !== false && input.inventory_item_id) {
      coreLinks.push({
        [Modules.INVENTORY]: { inventory_item_id: input.inventory_item_id },
        [CONSUMPTION_LOG_MODULE]: { consumption_log_id: input.log_id },
      })
    }

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
  function (input: LogConsumptionInput) {
    validateDesignStep({ design_id: input.design_id })

    // Only validate inventory item for material types (not energy/labor)
    const hasInventoryItem = transform({ input }, (data) => ({
      inventory_item_id: data.input.inventory_item_id || "",
      has_item: !!data.input.inventory_item_id &&
        !NON_INVENTORY_TYPES.includes(data.input.consumption_type || ""),
    }))

    when(hasInventoryItem, (data) => data.has_item).then(() => {
      validateInventoryItemStep({ inventory_item_id: hasInventoryItem.inventory_item_id })
    })

    // Only material consumption against a named run can be off-plan; energy and
    // labour have no inventory item to be outside the allocation.
    const allocationCheck = transform({ input }, (data) => ({
      production_run_id: data.input.production_run_id || "",
      inventory_item_id: data.input.inventory_item_id || "",
      applies:
        !!data.input.production_run_id &&
        !!data.input.inventory_item_id &&
        !NON_INVENTORY_TYPES.includes(data.input.consumption_type || ""),
    }))

    when(allocationCheck, (data) => data.applies).then(() => {
      assertConsumptionWithinAllocationStep({
        production_run_id: allocationCheck.production_run_id,
        inventory_item_id: allocationCheck.inventory_item_id,
      })
    })

    const log = createConsumptionLogStep(input)

    const logId = transform({ log }, ({ log }) => log.id) as unknown as string

    // Build link input — inventory_item_id may be empty for energy/labor
    const linkInput = transform(
      { input, logId },
      (data) => ({
        design_id: data.input.design_id,
        production_run_id: data.input.production_run_id,
        inventory_item_id: data.input.inventory_item_id || "",
        log_id: data.logId as string,
        has_inventory: !!data.input.inventory_item_id &&
          !NON_INVENTORY_TYPES.includes(data.input.consumption_type || ""),
      })
    )

    linkConsumptionLogStep(linkInput)

    return new WorkflowResponse(log)
  }
)
