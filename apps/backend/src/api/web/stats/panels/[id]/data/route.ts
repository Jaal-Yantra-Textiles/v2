import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../../../../../../modules/stats"
import StatsService from "../../../../../../modules/stats/service"
import { resolvePanel } from "../../../../../../modules/stats/resolver"
import {
  isPanelPublic,
  stripExcludedColumns,
} from "../../../../../../modules/stats/public-utils"

/**
 * GET /web/stats/panels/:id/data
 *
 * Public read endpoint for stats panels. Designed for marketing-site /
 * blog embeds: an editor drops `<StatsPanel id="panel_..." />` into a
 * blog post and the component fetches from here.
 *
 * Safety
 * - Panels are NOT public by default. Only panels with
 *   `metadata.public === true` resolve; everything else returns 404.
 *   This is an explicit opt-in per panel — admins decide what's safe
 *   to expose.
 * - `display.exclude_columns` is applied **server-side** so the wire
 *   payload doesn't leak joined entities even if a consumer ignores
 *   the display config. Same denylist the renderer uses.
 *
 * Cache
 * - `s-maxage=120, swr=300` — blog traffic is read-heavy and panel
 *   data is rarely fresh-required at sub-minute resolution. Edge
 *   caches absorb spikes; readers see stale-while-revalidate during
 *   refresh.
 * - The panel's own `cache_ttl_seconds` still applies inside
 *   `resolvePanel` (in-memory cache); this just adds an edge layer.
 *
 * Response shape mirrors the admin POST endpoint so the same renderer
 * can be reused on the marketing-site side:
 *   { panel_id, type, name, data, display, resolved_at }
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: StatsService = req.scope.resolve(STATS_MODULE)

  let panel: any
  try {
    panel = await service.retrieveStatsPanel(id)
  } catch (err: any) {
    // Don't leak whether the id exists at all — same 404 either way.
    if (err?.type === "not_found") {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Panel not found")
    }
    throw err
  }

  if (!isPanelPublic(panel)) {
    // Same 404 shape as "doesn't exist" so we don't reveal which panels
    // exist privately.
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
    { skipCache: false }
  )

  const display = (panel.display ?? {}) as Record<string, any>
  const data = stripExcludedColumns(display, result.data)

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=120, stale-while-revalidate=300"
  )
  res.json({
    panel_id: panel.id,
    type: panel.type,
    name: panel.name,
    data,
    display,
    resolved_at: result.resolved_at,
  })
}
