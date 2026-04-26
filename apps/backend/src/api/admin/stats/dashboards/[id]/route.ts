import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { STATS_MODULE } from "../../../../../modules/stats"
import StatsService from "../../../../../modules/stats/service"
import { updateDashboardSchema } from "../../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params

    const dashboard = await service.retrieveStatsDashboard(id, {
      relations: ["panels"],
    })

    res.json({ dashboard })
  } catch (error: any) {
    res.status(error.type === "not_found" ? 404 : 400).json({ error: error.message })
  }
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params
    const data = updateDashboardSchema.parse(req.body)

    const dashboard = await service.updateStatsDashboards({ id, ...data })

    res.json({ dashboard })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.errors })
      return
    }
    res.status(400).json({ error: error.message })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params

    const [panels] = await service.listAndCountStatsPanels({ dashboard_id: id })
    if (panels.length > 0) {
      await service.deleteStatsPanels(panels.map((p: any) => p.id))
    }

    await service.deleteStatsDashboards(id)

    res.json({ id, object: "stats_dashboard", deleted: true })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
