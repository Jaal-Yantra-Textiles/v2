import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { inlineImageAsDataUrl } from "../../../../../../modules/designs/lib/inline-image"

/**
 * GET /admin/designs/:id/moodboard/image?src=<url>
 *
 * Admin twin of the partner image proxy (#2228) — the surface where the export
 * actually failed with "The operation is insecure", because there the image
 * renders and taints the canvas.
 *
 * No design-scoped guard here beyond admin authentication: an admin may already
 * read every design's media through the design routes, so adding one would
 * describe a boundary that does not exist. The SSRF gate is the same shared one.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const data_url = await inlineImageAsDataUrl((req.query as any)?.src)
  res.json({ data_url })
}
