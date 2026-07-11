import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../../../../../../modules/stats"
import StatsService from "../../../../../../modules/stats/service"
import { resolvePanel } from "../../../../../../modules/stats/resolver"
import { requireInvestor } from "../../../../helpers"

// GET /investors/stats/panels/:id/data — resolve a single investor-visible panel.
// 404s unless the panel is explicitly flagged `metadata.investor === true`, so
// investor auth can never be used to read an arbitrary internal dashboard panel.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  try {
    await requireInvestor(req.auth_context, req.scope)

    const service: StatsService = req.scope.resolve(STATS_MODULE)
    const { id } = req.params
    const skipCache = req.query?.skip_cache === "true"

    const panel = await service.retrieveStatsPanel(id)
    if (((panel as any).metadata ?? {})?.investor !== true) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Panel not found")
    }

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
      name: panel.name,
      type: panel.type,
      ...result,
      display: panel.display ?? {},
    })
  } catch (error: any) {
    const notFound = error.type === "not_found" || error.type === MedusaError.Types.NOT_FOUND
    res.status(notFound ? 404 : 400).json({ error: error.message })
  }
}
