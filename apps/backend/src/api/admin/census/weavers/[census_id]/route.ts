import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { CENSUS_MODULE } from "../../../../../modules/census"
import type CensusModuleService from "../../../../../modules/census/service"

/**
 * GET /admin/census/weavers/:census_id
 *
 * A single weaver's MASKED census record (PII-free — name/mobile/coords/religion
 * live only in the sensitive core, surfaced separately via …/unmask). Used by the
 * weaver detail view in the admin persons section.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService

  if (!census.connected) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "census P2P reader not connected — try again shortly"
    )
  }

  const weaver = await census.retrieveWeaver(req.params.census_id)
  if (!weaver) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `no census weaver with id ${req.params.census_id}`
    )
  }

  res.json({ weaver })
}