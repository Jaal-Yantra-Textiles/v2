import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { IInventoryService } from "@medusajs/framework/types"
import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import ConsumptionLogService from "../../modules/consumption_log/service"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"

export type CommitConsumptionInput = {
  design_id: string
  log_ids?: string[]
  commit_all?: boolean
  default_location_id?: string
}

const fetchUncommittedLogsStep = createStep(
  "commit-consumption-fetch-logs",
  async (input: CommitConsumptionInput, { container }) => {
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)

    const filters: Record<string, any> = {
      design_id: input.design_id,
      is_committed: false,
    }

    if (input.log_ids?.length && !input.commit_all) {
      filters.id = input.log_ids
    }

    const [logs] = await service.listAndCountConsumptionLogs(filters, {
      take: null,
    })

    if (!logs.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No uncommitted consumption logs found for this design"
      )
    }

    return new StepResponse(logs)
  }
)

const adjustInventoryFromLogsStep = createStep(
  "commit-consumption-adjust-inventory",
  async (
    input: { logs: any[]; default_location_id?: string },
    { container }
  ) => {
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const adjustments: Array<{
      inventoryItemId: string
      locationId: string
      adjustment: number
    }> = []

    for (const log of input.logs) {
      let locationId = log.location_id || input.default_location_id

      if (!locationId) {
        // Try to resolve from inventory item's location levels
        const { data } = await query.graph({
          entity: "inventory_items",
          fields: ["location_levels.location_id"],
          filters: { id: log.inventory_item_id },
        })

        const levels = data?.[0]?.location_levels || []
        locationId = levels[0]?.location_id

        if (!locationId) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `No stock location found for inventory item ${log.inventory_item_id}. Provide location_id on the log or in the commit request.`
          )
        }
      }

      adjustments.push({
        inventoryItemId: log.inventory_item_id,
        locationId,
        adjustment: -Math.abs(log.quantity),
      })
    }

    if (adjustments.length) {
      await inventoryService.adjustInventory(adjustments)
    }

    return new StepResponse(adjustments, adjustments)
  },
  async (adjustments, { container }) => {
    if (!adjustments?.length) return
    // Rollback: reverse the adjustments
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const reversals = adjustments.map((adj) => ({
      ...adj,
      adjustment: -adj.adjustment,
    }))
    await inventoryService.adjustInventory(reversals)
  }
)

const markLogsCommittedStep = createStep(
  "commit-consumption-mark-committed",
  async (input: { log_ids: string[] }, { container }) => {
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)

    const updated = await Promise.all(
      input.log_ids.map((id) =>
        service.updateConsumptionLogs({
          id,
          is_committed: true,
          metadata: {
            committed_at: new Date().toISOString(),
          },
        })
      )
    )

    return new StepResponse(updated, input.log_ids)
  },
  async (logIds, { container }) => {
    if (!logIds?.length) return
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)
    await Promise.all(
      logIds.map((id) =>
        service.updateConsumptionLogs({
          id,
          is_committed: false,
        })
      )
    )
  }
)

export const commitConsumptionWorkflow = createWorkflow(
  {
    name: "commit-consumption",
    store: true,
  },
  (input: CommitConsumptionInput) => {
    const logs = fetchUncommittedLogsStep(input)

    const logIds = transform({ logs }, ({ logs }) =>
      logs.map((l: any) => l.id)
    ) as unknown as string[]

    const adjustments = adjustInventoryFromLogsStep({
      logs,
      default_location_id: input.default_location_id,
    })

    const committed = markLogsCommittedStep({ log_ids: logIds })

    return new WorkflowResponse({
      committed_count: transform({ logIds }, ({ logIds }) => logIds.length),
      adjustments,
      logs: committed,
    })
  }
)
