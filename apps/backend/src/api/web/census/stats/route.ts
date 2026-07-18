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
  // Aggregates only change on re-seed → let the CDN/edge hold them. s-maxage caches
  // at the edge for 10min; stale-while-revalidate serves stale up to 1h while a
  // fresh copy is fetched in the background. Pairs with the reader's in-process memo.
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600")
  res.json({ stats })
}
