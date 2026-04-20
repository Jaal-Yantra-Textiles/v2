import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STATS_MODULE } from "../../../../../../modules/stats"
import StatsService from "../../../../../../modules/stats/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params

    const source = await service.retrieveStatsDashboard(id, {
      relations: ["panels"],
    })

    const created = await service.createStatsDashboards({
      name: `${source.name} (copy)`,
      description: source.description,
      icon: source.icon,
      color: source.color,
      metadata: source.metadata ?? {},
    })

    const panels = (source as any).panels ?? []
    if (panels.length > 0) {
      await service.createStatsPanels(
        panels.map((p: any) => ({
          dashboard_id: created.id,
          name: p.name,
          type: p.type,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          operation_type: p.operation_type,
          operation_options: p.operation_options ?? {},
          display: p.display ?? {},
          cache_ttl_seconds: p.cache_ttl_seconds,
          metadata: p.metadata ?? {},
        }))
      )
    }

    const dashboard = await service.retrieveStatsDashboard(created.id, {
      relations: ["panels"],
    })

    res.status(201).json({ dashboard })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
}
