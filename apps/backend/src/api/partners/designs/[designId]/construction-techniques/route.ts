import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CONSTRUCTION_FAMILIES,
  CONSTRUCTION_TECHNIQUES,
} from "../../../../../modules/designs/construction-techniques"
import { assertPartnerCanAuthorDesign } from "../../helpers"

/**
 * GET /partners/designs/:designId/construction-techniques
 *
 * The construction catalog the partner-ui picker renders (#1113 Feature B):
 * categorized techniques with param defs, default fabric rules and presets —
 * served verbatim from the canonical construction-techniques module so the
 * picker never hardcodes the list. Author-scoped for consistency with the rest
 * of the moodboard surface (the payload itself is static).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  await assertPartnerCanAuthorDesign(req, req.params.designId)
  res.json({
    families: CONSTRUCTION_FAMILIES,
    techniques: CONSTRUCTION_TECHNIQUES,
  })
}
