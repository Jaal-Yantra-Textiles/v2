import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import ConsumptionLogService from "../../modules/consumption_log/service"
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material"

export type CommitConsumptionInput = {
  design_id: string
  log_ids?: string[]
  commit_all?: boolean
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

/**
 * Propagate unit_cost from committed consumption logs to raw materials.
 * For each inventory item consumed, look up the linked raw material and
 * update its unit_cost. This ensures the estimate workflow can pick up
 * partner-provided costs when calculating design estimates.
 *
 * Partners don't maintain stock levels in the system — they only report
 * consumption. Inventory adjustment is intentionally NOT done here;
 * partner inventory tracking is a future feature.
 */
const propagateCostsStep = createStep(
  "commit-consumption-propagate-costs",
  async (input: { logs: any[] }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const rawMaterialService = container.resolve(RAW_MATERIAL_MODULE) as any

    // Track old values for compensation
    const oldValues: Array<{
      raw_material_id: string
      old_unit_cost: number | null
    }> = []

    // Group logs by inventory_item_id, keep only the latest (by consumed_at)
    const latestByItem = new Map<string, any>()
    for (const log of input.logs) {
      if (!log.unit_cost || Number(log.unit_cost) <= 0) continue
      const existing = latestByItem.get(log.inventory_item_id)
      if (
        !existing ||
        new Date(log.consumed_at) > new Date(existing.consumed_at)
      ) {
        latestByItem.set(log.inventory_item_id, log)
      }
    }

    for (const [inventoryItemId, log] of latestByItem) {
      const unitCost = Number(log.unit_cost)

      // Resolve raw material ID: from the log directly, or via inventory-raw material link
      let rawMaterialId = log.raw_material_id
      if (!rawMaterialId) {
        try {
          const { data: rmLinks } = await query.graph({
            entity: "inventory_item_raw_materials",
            filters: { inventory_item_id: inventoryItemId },
            fields: ["raw_materials.id"],
          })
          rawMaterialId = rmLinks?.[0]?.raw_materials?.id
        } catch {
          // Link may not exist
        }
      }

      if (!rawMaterialId) continue

      // Update raw material unit_cost
      try {
        const rm = await rawMaterialService.retrieveRawMaterial(rawMaterialId)
        const oldCost = rm.unit_cost != null ? Number(rm.unit_cost) : null

        await rawMaterialService.updateRawMaterials({
          id: rawMaterialId,
          unit_cost: unitCost,
        })

        oldValues.push({
          raw_material_id: rawMaterialId,
          old_unit_cost: oldCost,
        })
      } catch (e: any) {
        console.warn(`[propagate-costs] Failed to update raw material ${rawMaterialId}:`, e?.message)
      }
    }

    return new StepResponse(oldValues, oldValues)
  },
  async (oldValues, { container }) => {
    if (!oldValues?.length) return
    const rawMaterialService = container.resolve(RAW_MATERIAL_MODULE) as any

    for (const entry of oldValues) {
      try {
        await rawMaterialService.updateRawMaterials({
          id: entry.raw_material_id,
          unit_cost: entry.old_unit_cost,
        })
      } catch {}
    }
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

    const committed = markLogsCommittedStep({ log_ids: logIds })

    const costUpdates = propagateCostsStep({ logs })

    return new WorkflowResponse({
      committed_count: transform({ logIds }, ({ logIds }) => logIds.length),
      cost_updates: costUpdates,
      logs: committed,
    })
  }
)
