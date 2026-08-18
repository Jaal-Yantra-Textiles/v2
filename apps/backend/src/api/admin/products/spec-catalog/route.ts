import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  WEAVE_FAMILIES,
  WEAVE_TECHNIQUES,
} from "../../../../modules/product-spec/weaving-techniques"

/**
 * The weaving-technique catalog, admin side (#1346).
 *
 * Serves the same canonical module the partner route serves and the workflow
 * validates against, so an admin assistant proposing `gsm: 900` is reading the
 * very ranges its write will be judged by.
 *
 * @route GET /admin/products/spec-catalog
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  return res.json({
    families: WEAVE_FAMILIES,
    techniques: WEAVE_TECHNIQUES,
  })
}
