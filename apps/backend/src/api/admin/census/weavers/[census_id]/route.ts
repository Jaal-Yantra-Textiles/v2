import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { CENSUS_MODULE } from "../../../../../modules/census"
import type CensusModuleService from "../../../../../modules/census/service"
import { PERSON_PROPERTY_MODULE } from "../../../../../modules/personproperty"
import {
  applyWeaverCorrections,
  WeaverCorrection,
} from "../../../../../modules/personproperty/lib/apply-weaver-corrections"

/**
 * GET /admin/census/weavers/:census_id
 *
 * A single weaver's MASKED census record (PII-free), with any admin corrections
 * overlayed at read time. The census core is never written to — corrections live
 * as an appended list on the person_property record (keyed by census_id) and are
 * applied here as a pure projection so the detail view shows corrected values.
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

  // Corrections are best-effort: a weaver with no person_property record (or a
  // reader-mode where the property module is unavailable) simply has none.
  let corrections: WeaverCorrection[] = []
  try {
    const propertyService: any = req.scope.resolve(PERSON_PROPERTY_MODULE)
    /*
     * 🔴 `listAndCount*` returns `[rows, count]`. Read as `[property]` this was
     * an ARRAY, `property?.corrections` was undefined, and the overlay below
     * silently applied nothing — the read-time correction, which is the whole
     * point of this route, never once fired. The `catch` made it quieter still:
     * there was no error to see, just a weaver that ignored its corrections.
     */
    const [rows] = await propertyService.listAndCountPersonProperties(
      { census_id: req.params.census_id },
      { take: 1 }
    )
    corrections = (rows?.[0]?.corrections ?? []) as WeaverCorrection[]
  } catch {
    // no corrections — fall through with the raw record
  }

  const { weaver: effective, corrected_fields } = applyWeaverCorrections(weaver, corrections)

  res.json({ weaver: effective, corrections, corrected_fields })
}