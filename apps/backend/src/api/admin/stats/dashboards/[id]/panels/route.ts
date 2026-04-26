import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { STATS_MODULE } from "../../../../../../modules/stats"
import StatsService from "../../../../../../modules/stats/service"
import { operationRegistry } from "../../../../../../modules/visual_flows/operations/types"
import { createPanelSchema } from "../../../validators"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id: dashboardId } = req.params
    const data = createPanelSchema.parse(req.body)

    await service.retrieveStatsDashboard(dashboardId)

    const operation = operationRegistry.get(data.operation_type)
    if (!operation) {
      return res.status(400).json({
        error: `Unknown operation_type: ${data.operation_type}`,
      })
    }

    const optionsResult = operation.optionsSchema.safeParse(data.operation_options)
    if (!optionsResult.success) {
      return res.status(400).json({
        error: "Invalid operation_options for this operation_type",
        details: optionsResult.error.issues,
      })
    }

    const panel = await service.createStatsPanels({
      dashboard_id: dashboardId,
      ...data,
      operation_options: optionsResult.data,
    } as any)

    res.status(201).json({ panel })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.issues })
      return
    }
    res.status(400).json({ error: error.message })
  }
}
