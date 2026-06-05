import { AuthenticatedMedusaRequest } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

/**
 * Resolve the design + assert the authenticated partner OWNS it
 * (created it via the self-serve flow, `owner_partner_id` === partner).
 * Ownership is stricter than assignment — an admin-assigned design is
 * readable but not mutable by the partner. Throws 401/400(NOT_ALLOWED)/404.
 *
 * Shared by the partner design detail route (PUT/DELETE) and the
 * design-inventory (BOM) routes so the guard stays consistent.
 */
export async function assertPartnerOwnsDesign(
  req: AuthenticatedMedusaRequest,
  designId: string
): Promise<{ partner: any; design: any }> {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "owner_partner_id", "name", "status"],
  })
  const design = (data || [])[0] as any
  if (!design) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Design not found")
  }
  if (design.owner_partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You can only modify designs you created"
    )
  }
  return { partner, design }
}

/**
 * Resolve the partner's primary store + its default location/sales
 * channel. Used to scope inventory-link locations to the partner's own
 * warehouse (a partner must not pin a design's BOM line to a location
 * they don't own).
 */
export async function getPartnerPrimaryStore(
  req: AuthenticatedMedusaRequest,
  partnerId: string
): Promise<any | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partner",
    filters: { id: partnerId },
    fields: [
      "id",
      "stores.id",
      "stores.default_location_id",
      "stores.default_sales_channel_id",
    ],
  })
  return (data?.[0] as any)?.stores?.[0] ?? null
}
