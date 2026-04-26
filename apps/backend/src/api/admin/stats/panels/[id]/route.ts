import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { STATS_MODULE } from "../../../../../modules/stats"
import StatsService from "../../../../../modules/stats/service"
import { operationRegistry } from "../../../../../modules/visual_flows/operations/types"
import { invalidatePanelCache } from "../../../../../modules/stats/resolver"
import { updatePanelSchema } from "../../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params

    const panel = await service.retrieveStatsPanel(id)
    res.json({ panel })
  } catch (error: any) {
    res.status(error.type === "not_found" ? 404 : 400).json({ error: error.message })
  }
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params
    const data = updatePanelSchema.parse(req.body)

    if (data.operation_type || data.operation_options) {
      const existing = await service.retrieveStatsPanel(id)
      const nextType = data.operation_type ?? existing.operation_type
      const nextOptions = data.operation_options ?? existing.operation_options ?? {}
      const operation = operationRegistry.get(nextType)
      if (!operation) {
        return res.status(400).json({ error: `Unknown operation_type: ${nextType}` })
      }
      const optionsResult = operation.optionsSchema.safeParse(nextOptions)
      if (!optionsResult.success) {
        return res.status(400).json({
          error: "Invalid operation_options for this operation_type",
          details: optionsResult.error.issues,
        })
      }
      // optionsResult.data narrows to `unknown` under Zod v4 generics; the
      // operation registry validates it as a record-shaped schema, so cast.
      data.operation_options = optionsResult.data as Record<string, any>
    }

    const panel = await service.updateStatsPanels({ id, ...data })
    invalidatePanelCache(id)

    res.json({ panel })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.issues })
      return
    }
    res.status(400).json({ error: error.message })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params

    await service.deleteStatsPanels(id)
    invalidatePanelCache(id)

    res.json({ id, object: "stats_panel", deleted: true })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
