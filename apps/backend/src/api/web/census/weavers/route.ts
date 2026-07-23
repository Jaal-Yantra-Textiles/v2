import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CENSUS_MODULE } from "../../../../modules/census"
import type CensusModuleService from "../../../../modules/census/service"
import type { WeaverFilters } from "../../../../modules/census/reader"

// public, non-sensitive fields the masked-record browse may be filtered by.
// (Sensitive/special-category fields never reach the public core, so they're
// simply absent here — this whitelist keeps the scan predicate intentional.)
const FILTERABLE = [
  "state", "district", "block", "village", "gender", "rural_urban",
  "own_looms", "natural_dye_used", "education", "ownership_type",
  "household_type", "dwelling_type", "electricity",
] as const

/**
 * GET /web/census/weavers?state=HARYANA&gender=Female&limit=20&offset=0
 * Public (/web/* is CORS-only) paginated masked (PII-free) weaver records.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService

  if (!census.connected) {
    return res.status(503).json({
      message: "census P2P reader not connected yet — try again shortly",
    })
  }

  const q = req.query as Record<string, string | undefined>

  // Single-record lookup by census_id. Handled explicitly (not via the filter
  // scan below) so it resolves the exact record through the keyed `rec/<id>`
  // get — passing it as an un-whitelisted filter would be dropped, silently
  // returning page-one of *all* weavers instead of the requested record.
  if (q.census_id !== undefined && q.census_id !== "") {
    const weaver = await census.retrieveWeaver(q.census_id)
    if (!weaver) {
      return res.status(404).json({ message: `no census weaver with id ${q.census_id}` })
    }
    return res.json({ weaver })
  }

  const filters: WeaverFilters = {}
  for (const f of FILTERABLE) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string
  }

  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)
  // Opaque forward cursor (last census_id of the previous page). Preferred over
  // offset at scale — pagination stays O(page) instead of degrading with depth.
  const after = q.after !== undefined && q.after !== "" ? q.after : undefined

  const { weavers, count, capped, next, indexed, estimated } =
    await census.listAndCountWeavers(filters, { limit, offset, after })

  res.json({
    weavers,
    count,
    limit,
    offset,
    ...(next ? { next } : {}),
    ...(indexed !== undefined ? { indexed } : {}),
    ...(estimated ? { estimated: true } : {}),
    ...(capped ? { capped: true } : {}),
  })
}
