import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"

/**
 * Verify reservation belongs to a partner's stock locations.
 */
async function verifyReservationOwnership(
  partnerId: string,
  reservationId: string,
  scope: any
): Promise<any> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const inventoryService = scope.resolve(Modules.INVENTORY) as any

  const reservation = await inventoryService.retrieveReservationItem(reservationId)
  if (!reservation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reservation not found")
  }

  // Check location belongs to partner
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["stores.default_sales_channel_id"],
    filters: { id: partnerId },
  })

  const salesChannelId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
  if (!salesChannelId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reservation not found")
  }

  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: ["stock_locations.id"],
    filters: { id: salesChannelId },
  })

  const partnerLocationIds = (channels?.[0]?.stock_locations || [])
    .map((l: any) => l?.id)
    .filter(Boolean)

  if (!partnerLocationIds.includes(reservation.location_id)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Reservation not found")
  }

  return reservation
}

/**
 * GET /partners/reservations/:id
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const reservation = await verifyReservationOwnership(partnerId, req.params.id, req.scope)
  res.json({ reservation })
}

/**
 * POST /partners/reservations/:id
 * Update a reservation.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  await verifyReservationOwnership(partnerId, req.params.id, req.scope)

  const body = req.body as {
    quantity?: number
    location_id?: string
    description?: string
  }

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const updated = await inventoryService.updateReservationItems({
    id: req.params.id,
    ...body,
  })

  res.json({ reservation: updated })
}

/**
 * DELETE /partners/reservations/:id
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  await verifyReservationOwnership(partnerId, req.params.id, req.scope)

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  await inventoryService.deleteReservationItems(req.params.id)

  res.json({ id: req.params.id, object: "reservation", deleted: true })
}
