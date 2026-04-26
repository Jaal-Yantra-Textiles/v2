import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STATS_MODULE } from "../../../../../../modules/stats"
import StatsService from "../../../../../../modules/stats/service"
import { resolvePanel } from "../../../../../../modules/stats/resolver"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params
    const skipCache = req.query?.skip_cache === "true"

    const panel = await service.retrieveStatsPanel(id)

    const result = await resolvePanel(
      req.scope,
      {
        id: panel.id,
        dashboard_id: (panel as any).dashboard_id,
        operation_type: panel.operation_type,
        operation_options: (panel.operation_options ?? {}) as Record<string, any>,
        display: (panel.display ?? {}) as Record<string, any>,
        cache_ttl_seconds: panel.cache_ttl_seconds,
      },
      { skipCache }
    )

    res.json({
      panel_id: panel.id,
      ...result,
      display: panel.display ?? {},
    })
  } catch (error: any) {
    res.status(error.type === "not_found" ? 404 : 400).json({ error: error.message })
  }
}
