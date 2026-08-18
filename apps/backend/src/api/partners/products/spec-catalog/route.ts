import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  WEAVE_FAMILIES,
  WEAVE_TECHNIQUES,
} from "../../../../modules/product-spec/weaving-techniques"

/**
 * Serve the weaving-technique catalog to the partner-ui spec picker (#1342).
 *
 * Static data, served verbatim from the one canonical module so the picker's
 * ranges, defaults and presets cannot drift from the ones the workflow
 * validates against — the drift that made `construction-techniques.ts`
 * necessary in the first place (it replaced three hand-synced copies).
 *
 * Authenticated because it is partner tooling, not because the catalog is
 * secret.
 *
 * @route GET /partners/products/spec-catalog
 */
export const GET = async (
  _req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  return res.json({
    families: WEAVE_FAMILIES,
    techniques: WEAVE_TECHNIQUES,
  })
}
