import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CENSUS_MODULE } from "../../../../modules/census"
import type CensusModuleService from "../../../../modules/census/service"

/**
 * GET /admin/census/states
 *
 * The complete list of geographic states present in the census, sourced from the
 * pre-computed aggregates (O(1), no per-record scan). Used to populate the weaver
 * "Region state" filter with EVERY state, not just the few on the current page.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService

  if (!census.connected) {
    return res.status(503).json({ states: [] })
  }

  const stats = await census.getStats()
  const states = Object.entries(stats.state ?? {})
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => a.state.localeCompare(b.state))

  res.json({ states })
}