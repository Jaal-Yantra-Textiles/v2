/**
 * Storefront design-assistant — read a maker's board.
 *
 *   GET /store/custom/design-assistant/designs/:id?customer_email=…
 *
 * ## Why this exists rather than reusing `/store/custom/designs/:id`
 *
 * 🔴 The board panel — the whole visible point of the chat editor — read the
 * design through the CUSTOMER-authenticated route, in a flow whose entire
 * premise is a guest identified only by an email. Every read answered
 * `401 Customer authentication required`, the client swallowed it in a
 * `catch {}` marked "best-effort", and the panel sat on "Your board is empty"
 * while the chat itself rendered both takes a few pixels to the left.
 *
 * So the feature looked like it worked in the transcript and had never once
 * worked on the board. Nothing failed loudly: 15 backend tests pass, the chat
 * renders, and the only way to see it is to open the page.
 *
 * ## Ownership
 *
 * 🔴 #2543: this used to be scoped by `?customer_email=` — the design↔customer
 * link resolved from an email anyone can type. It now requires the design's
 * access token (`x-design-token`) or a signed-in customer linked to the design
 * (lib/design-access/authorize.ts). The check runs before the design is read,
 * so "not yours" (403) says nothing about whether the id exists.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  assertDesignAccess,
  readDesignCredentials,
} from "../../../../../../lib/design-access/authorize"
import { DESIGN_MODULE } from "../../../../../../modules/designs"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const designId = String(req.params.id || "").trim()
  await assertDesignAccess(req.scope as any, designId, readDesignCredentials(req))

  const designService: any = req.scope.resolve(DESIGN_MODULE)
  const design = await designService.retrieveDesign(designId).catch(() => null)
  if (!design) return res.status(404).json({ message: "Design not found" })

  // Only what the board renders. The design row carries costs and partner
  // notes that a public read has no business returning.
  return res.status(200).json({
    design: {
      id: design.id,
      name: design.name ?? null,
      thumbnail_url: design.thumbnail_url ?? null,
      moodboard: design.moodboard ?? null,
    },
  })
}
