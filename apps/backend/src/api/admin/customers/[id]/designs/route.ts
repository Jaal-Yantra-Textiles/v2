import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import designCustomerLink from "../../../../../links/design-customer-link"

type LinkDesignsBody = {
  design_ids: string[]
}

/**
 * Bulk attach, kept for the one thing it does better than the design-scoped
 * route: a whole range in one call (#2111).
 *
 * 🔴 It used to APPEND, which permitted a state the model does not have —
 * several customers on one design. `design ↔ customer` answers "whose design is
 * this", a single commissioner; who has BOUGHT a design is a different question
 * answered through its runs and their orders. Two rows made the answer depend
 * on which surface read it first: the list route takes the first row, the email
 * workflow takes `take: 1`, so two screens could name two different people and
 * a client could receive mail about someone else's piece.
 *
 * So each design named here is now attached to exactly one customer — this one —
 * and any other commissioner on it is dismissed first. Same rule as
 * `POST /admin/designs/:id/customer`, which is where a single design should be
 * changed from.
 */

export const POST = async (
  req: MedusaRequest<LinkDesignsBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids } = req.validatedBody as LinkDesignsBody

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /*
   * Dismiss any OTHER commissioner on these designs first. Read through the
   * link's own `entryPoint`, never as a field hop: a hop can come back with no
   * key at all rather than an error, and here that would silently skip the
   * dismissal and re-create the very duplication this exists to prevent.
   */
  const { data: existing = [] } = await query
    .graph({
      entity: designCustomerLink.entryPoint,
      filters: { design_id: design_ids },
      fields: ["design_id", "customer_id"],
    })
    .catch(() => ({ data: [] }))

  const stale = (existing as any[]).filter(
    (l) => l?.customer_id && l.customer_id !== customer_id
  )

  if (stale.length) {
    await remoteLink.dismiss(
      stale.map((l) => ({
        [DESIGN_MODULE]: { design_id: l.design_id },
        [Modules.CUSTOMER]: { customer_id: l.customer_id },
      }))
    )
  }

  const links = design_ids.map((design_id) => ({
    [DESIGN_MODULE]: { design_id },
    [Modules.CUSTOMER]: { customer_id },
  }))

  await remoteLink.create(links)

  res.json({ linked: design_ids.length, replaced: stale.length })
}

export const DELETE = async (
  req: MedusaRequest<LinkDesignsBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids } = req.validatedBody as LinkDesignsBody

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  const links = design_ids.map((design_id) => ({
    [DESIGN_MODULE]: { design_id },
    [Modules.CUSTOMER]: { customer_id },
  }))

  await remoteLink.dismiss(links)

  res.json({ unlinked: design_ids.length })
}
