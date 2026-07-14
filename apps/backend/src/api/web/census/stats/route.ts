import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CENSUS_MODULE } from "../../../../modules/census"
import type CensusModuleService from "../../../../modules/census/service"

/**
 * GET /web/census/stats  (public — /web/* is CORS-only, no publishable key)
 * Public handloom-census analytics: pre-computed aggregates from the P2P public
 * core, k-anonymity suppressed (cells below the threshold return null). No PII,
 * no per-record scan. Special-category dims (social_group/religion) are never here.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService

  if (!census.connected) {
    return res.status(503).json({
      message: "census P2P reader not connected yet — try again shortly",
    })
  }

  const stats = await census.getStats()
  res.json({ stats })
}
