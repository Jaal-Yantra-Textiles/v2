import { AuthenticatedMedusaRequest } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import designPartnersLink from "../../../links/design-partners-link"

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
 * Resolve the design + assert the authenticated partner may AUTHOR it — either
 * the owner (`owner_partner_id`) OR a partner the design is assigned to via
 * `design_partners_link`. This is the moodboard-authoring guard (#1113 S2/S3):
 * an invited designer is *assigned* (the invite grants the link), not the
 * owner, but must still be able to generate/edit the brief moodboard.
 * Throws 401/404/400(NOT_ALLOWED).
 */
export async function assertPartnerCanAuthorDesign(
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
  if (design.owner_partner_id === partner.id) {
    return { partner, design }
  }
  // Not the owner — accept an assignment link (the invite grant).
  const { data: links = [] } = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: ["design_id", "partner_id"],
    filters: { design_id: designId, partner_id: partner.id },
    pagination: { skip: 0, take: 1 },
  })
  if (!links.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You can only author designs you own or are assigned to"
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
