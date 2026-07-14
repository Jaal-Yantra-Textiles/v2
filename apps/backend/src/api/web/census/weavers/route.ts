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
  const filters: WeaverFilters = {}
  for (const f of FILTERABLE) {
    if (q[f] !== undefined && q[f] !== "") filters[f] = q[f] as string
  }

  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
  const offset = Math.max(Number(q.offset) || 0, 0)

  const { weavers, count, capped } = await census.listAndCountWeavers(filters, { limit, offset })
  res.json({ weavers, count, limit, offset, ...(capped ? { capped: true } : {}) })
}
