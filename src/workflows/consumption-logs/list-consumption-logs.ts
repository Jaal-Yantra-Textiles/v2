import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { CONSUMPTION_LOG_MODULE } from "../../modules/consumption_log"
import ConsumptionLogService from "../../modules/consumption_log/service"

export type ListConsumptionLogsInput = {
  design_id?: string
  production_run_id?: string
  filters?: {
    consumption_type?: string
    is_committed?: boolean
    consumed_by?: string
    inventory_item_id?: string
  }
  limit?: number
  offset?: number
}

const listConsumptionLogsStep = createStep(
  "list-consumption-logs",
  async (input: ListConsumptionLogsInput, { container }) => {
    const service: ConsumptionLogService = container.resolve(CONSUMPTION_LOG_MODULE)

    const filters: Record<string, any> = {}

    if (input.design_id) {
      filters.design_id = input.design_id
    }
    if (input.production_run_id) {
      filters.production_run_id = input.production_run_id
    }

    if (input.filters?.consumption_type) {
      filters.consumption_type = input.filters.consumption_type
    }
    if (input.filters?.is_committed !== undefined) {
      filters.is_committed = input.filters.is_committed
    }
    if (input.filters?.consumed_by) {
      filters.consumed_by = input.filters.consumed_by
    }
    if (input.filters?.inventory_item_id) {
      filters.inventory_item_id = input.filters.inventory_item_id
    }

    const [logs, count] = await service.listAndCountConsumptionLogs(
      filters,
      {
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
        order: { consumed_at: "DESC" },
      }
    )

    return new StepResponse({ logs, count })
  }
)

export const listConsumptionLogsWorkflow = createWorkflow(
  {
    name: "list-consumption-logs",
    store: true,
  },
  (input: ListConsumptionLogsInput) => {
    const result = listConsumptionLogsStep(input)
    return new WorkflowResponse(result)
  }
)
