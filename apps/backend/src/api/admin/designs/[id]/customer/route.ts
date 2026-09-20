import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import designCustomerLink from "../../../../../links/design-customer-link"
import { DESIGN_MODULE } from "../../../../../modules/designs"

/**
 * POST /admin/designs/:id/customer — whose design is this?
 *
 * 🔴 Until this route existed, a design could only acquire a customer by being
 * SOLD. `POST /admin/designs/orders/:lineItemId/customer` attaches the buyer of
 * a design ORDER, and it needs a cart line to work from — so a design that came
 * out of a conversation rather than a checkout had no way to say who it was
 * for, ever.
 *
 * That is not a theoretical gap. Every notification this platform can send
 * about a design — production started, production complete, materials linked,
 * status changed, and the arrival mail this route was built for — resolves its
 * recipient through `design ↔ customer` and returns SILENTLY when there is
 * none: the workflow's `when` guard simply does not fire. Measured on prod
 * 2026-09-20: all five Oshen designs, minted into published products and viewed
 * by the client, carry `customer_id: null`. Every update we believed was going
 * out had been going nowhere.
 *
 * Body: `{ customer_id: string | null }` — null detaches.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  /*
   * `validatedBody`, not `body`: the route is bound to
   * `AttachDesignCustomerSchema`, which is what the MCP route-validator
   * coverage guard checks the tool's advertised fields against. Reading the
   * raw body would leave that binding decorative.
   *
   * 🔴 The schema makes `customer_id` nullable but NOT optional. An omitted key
   * and an explicit null are different instructions — omitted is a malformed
   * request, null is "this design is nobody's" — and collapsing them would turn
   * a typo into a detach.
   */
  const raw = (req.validatedBody as { customer_id: string | null }).customer_id
  const customerId = typeof raw === "string" ? raw.trim() : null

  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "name"],
  })
  if (!designs?.length) {
    res.status(404).json({ message: `Design ${designId} was not found` })
    return
  }

  /*
   * A customer id that does not resolve must 404 rather than write. A link row
   * pointing at a customer who does not exist reads as "linked" on every screen
   * and reaches nobody — the precise failure this route exists to fix, rebuilt
   * one layer down.
   */
  if (customerId) {
    const customerService = req.scope.resolve(Modules.CUSTOMER) as any
    const [customer] = await customerService.listCustomers(
      { id: customerId },
      { select: ["id", "email"] }
    )
    if (!customer) {
      res.status(404).json({ message: `Customer ${customerId} does not exist.` })
      return
    }
  }

  const { data: existing = [] } = await query
    .graph({
      entity: designCustomerLink.entryPoint,
      filters: { design_id: designId },
      fields: ["design_id", "customer_id"],
    })
    .catch(() => ({ data: [] }))

  const linkedIds = (existing as any[]).map((l) => l?.customer_id).filter(Boolean)

  if (customerId && linkedIds.length === 1 && linkedIds[0] === customerId) {
    res.status(200).json({
      design_customer: { design_id: designId, customer_id: customerId, changed: false },
    })
    return
  }

  /*
   * Dismiss EVERY existing row, not just a different one. A design linked to
   * two customers answers "who is this for" with whichever row is read first —
   * the list route takes the first, the email workflow takes `take: 1` — so two
   * surfaces can name two different people. One design, one buyer.
   */
  if (linkedIds.length) {
    await remoteLink.dismiss(
      linkedIds.map((cid: string) => ({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: cid },
      }))
    )
  }

  if (customerId) {
    await remoteLink.create([
      {
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      },
    ])
  }

  res.status(200).json({
    design_customer: {
      design_id: designId,
      customer_id: customerId,
      changed: true,
      detached: linkedIds.filter((c: string) => c !== customerId),
    },
  })
}
