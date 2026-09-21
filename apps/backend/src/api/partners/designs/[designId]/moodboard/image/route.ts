import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { inlineImageAsDataUrl } from "../../../../../../modules/designs/lib/inline-image"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * GET /partners/designs/:designId/moodboard/image?src=<url>
 *
 * One image from the board, as a `data:` URI (#2228).
 *
 * The moodboard scene stores image files as a URL in Excalidraw's `dataURL`
 * field. Excalidraw cannot render that in the partner app, and in the admin it
 * renders but taints the canvas so the export is refused. The client swaps each
 * URL for the answer from here before handing the scene to the canvas.
 *
 * 🔴 Authenticated AND authorised, separately:
 *   - the middleware entry gives us `req.auth_context` — WITHOUT IT THIS ROUTE
 *     IS DEAD, which is exactly what happened to the seed route (#2229);
 *   - `assertPartnerCanAuthorDesign` then decides whether this partner may see
 *     this design's media at all. A proxy that skipped it would let any signed-
 *     in partner read any other partner's images by design id.
 *
 * The SSRF gate lives in `inline-image.ts` with the size and type checks, and
 * is unit-tested against look-alike hosts, scheme and port mismatches, the
 * cloud metadata address and non-http schemes.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  await assertPartnerCanAuthorDesign(req, req.params.designId)
  const data_url = await inlineImageAsDataUrl((req.query as any)?.src)
  res.json({ data_url })
}
