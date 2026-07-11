import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STATS_MODULE } from "../../../../modules/stats"
import StatsService from "../../../../modules/stats/service"
import { requireInvestor } from "../../helpers"

// GET /investors/stats/panels — the stats panels an investor is allowed to see.
// A panel opts in to the investor portal by setting `metadata.investor === true`
// (mirrors the `metadata.public === true` gate the /web embed uses). Returns the
// panel shells (no resolved data) so the Projections tab can lay out its grid;
// data is fetched per-panel from `./[id]/data`.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)

  const service: StatsService = req.scope.resolve(STATS_MODULE)
  const panels = await service.listStatsPanels(
    {},
    {
      take: 500,
      order: { y: "ASC", x: "ASC" },
    }
  )

  const investorPanels = (panels || []).filter(
    (p: any) => (p.metadata ?? {})?.investor === true
  )

  res.json({
    panels: investorPanels.map((p: any) => ({
      id: p.id,
      dashboard_id: p.dashboard_id,
      name: p.name,
      type: p.type,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      display: p.display ?? {},
      operation_type: p.operation_type,
    })),
    count: investorPanels.length,
  })
}
