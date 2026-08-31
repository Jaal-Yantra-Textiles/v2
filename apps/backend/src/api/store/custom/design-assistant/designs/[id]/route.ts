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
 * Scoped by the design↔customer link, resolved from the maker's email — the
 * same fact the flow already establishes when `create_design` links the guest
 * customer. That is deliberately stricter than the neighbouring `pick` route,
 * which treats knowledge of a `design_id` as sufficient: flipping the active
 * flag on a board you can already name is a much smaller disclosure than
 * handing over the whole scene, every prompt used and every image URL.
 *
 * 🔑 The customer is looked up, NEVER created. A read that creates a customer
 * row would let anyone mint guest accounts by GET, and would make the mere act
 * of loading a board change the data it reports on.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import designCustomerLink from "../../../../../../links/design-customer-link"
import { DESIGN_MODULE } from "../../../../../../modules/designs"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const designId = String(req.params.id || "").trim()
  const email = String((req.query as any)?.customer_email || "")
    .trim()
    .toLowerCase()

  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "customer_email is required to read a design board."
    )
  }

  const customerService: any = req.scope.resolve(Modules.CUSTOMER)
  const customers: any[] = await customerService
    .listCustomers({ email }, { take: 10 })
    .catch(() => [])

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /**
   * 🔴 "Not yours" and "not there" answer identically. A distinguishable 403
   * would turn a design id into an oracle for whether an email owns it — the
   * same reason `resolveDesignVariants` collapses the two.
   */
  const notFound = () =>
    res.status(404).json({ message: "Design not found" })

  if (!customers.length) return notFound()

  const { data: links = [] } = await query.graph({
    entity: designCustomerLink.entryPoint,
    fields: ["design_id", "customer_id"],
    filters: {
      design_id: designId,
      customer_id: customers.map((c) => c.id),
    },
  })

  if (!links?.length) return notFound()

  const designService: any = req.scope.resolve(DESIGN_MODULE)
  const design = await designService.retrieveDesign(designId).catch(() => null)
  if (!design) return notFound()

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
