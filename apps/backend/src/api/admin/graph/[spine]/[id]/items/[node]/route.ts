import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveGraphItems } from "../../../../../../../lib/graph/registry"

/**
 * GET /admin/graph/:spine/:id/items/:node
 *
 * The MEMBERS behind one aggregate node — the four inventory items behind
 * "Inventory, 4", each with the endpoint that would detach it.
 *
 * A second route rather than a fatter `/admin/graph/:spine/:id`, because the
 * canvas needs counts and the drawer needs rows, and only one of those is on
 * screen at a time. Folding the rows into the graph would make every canvas
 * render pay for panels nobody opened.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const items = await resolveGraphItems(
    req.scope,
    req.params.spine,
    req.params.id,
    req.params.node
  )
  res.json({ items })
}
