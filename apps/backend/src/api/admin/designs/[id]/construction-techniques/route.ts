import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CONSTRUCTION_FAMILIES,
  CONSTRUCTION_TECHNIQUES,
} from "../../../../../modules/designs/construction-techniques"

/**
 * GET /admin/designs/:id/construction-techniques
 *
 * The construction catalog the admin picker renders (#1113 Feature B) — the same
 * canonical, categorized techniques (param defs, default fabric rules, presets)
 * served to the partner picker.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    families: CONSTRUCTION_FAMILIES,
    techniques: CONSTRUCTION_TECHNIQUES,
  })
}
