import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"

/**
 * GET /partners/reservations
 *
 * List reservation items scoped to the partner's stock locations.
 * Accepts: limit, offset, inventory_item_id[], location_id[]
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Find the partner's stock locations via their store's sales channel
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["stores.default_sales_channel_id"],
    filters: { id: partnerId },
  })

  const salesChannelId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
  if (!salesChannelId) {
    return res.json({ reservations: [], count: 0, limit: 20, offset: 0 })
  }

  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: ["stock_locations.id"],
    filters: { id: salesChannelId },
  })

  const partnerLocationIds = (channels?.[0]?.stock_locations || [])
    .map((l: any) => l?.id)
    .filter(Boolean)

  if (!partnerLocationIds.length) {
    return res.json({ reservations: [], count: 0, limit: 20, offset: 0 })
  }

  // Parse query params
  const limit = Number(req.query.limit) || 20
  const offset = Number(req.query.offset) || 0

  // Build filters — scope to partner's locations
  const filters: Record<string, any> = {
    location_id: partnerLocationIds,
  }

  // Optional: filter by inventory_item_id
  const inventoryItemId = req.query.inventory_item_id
  if (inventoryItemId) {
    filters.inventory_item_id = Array.isArray(inventoryItemId)
      ? inventoryItemId
      : [inventoryItemId]
  }

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const [reservations, count] = await inventoryService.listAndCountReservationItems(
    filters,
    { take: limit, skip: offset }
  )

  res.json({
    reservations,
    count,
    limit,
    offset,
  })
}

/**
 * POST /partners/reservations
 *
 * Create a reservation item scoped to the partner's stock locations.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const body = req.body as {
    inventory_item_id: string
    location_id: string
    quantity: number
    description?: string
  }

  if (!body.inventory_item_id || !body.location_id || body.quantity == null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "inventory_item_id, location_id, and quantity are required"
    )
  }

  // Verify the location belongs to this partner
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["stores.default_sales_channel_id"],
    filters: { id: partnerId },
  })

  const salesChannelId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
  if (salesChannelId) {
    const { data: channels } = await query.graph({
      entity: "sales_channels",
      fields: ["stock_locations.id"],
      filters: { id: salesChannelId },
    })
    const partnerLocationIds = (channels?.[0]?.stock_locations || [])
      .map((l: any) => l?.id)
      .filter(Boolean)

    if (!partnerLocationIds.includes(body.location_id)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Location not found for this partner"
      )
    }
  }

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const reservation = await inventoryService.createReservationItems({
    inventory_item_id: body.inventory_item_id,
    location_id: body.location_id,
    quantity: body.quantity,
    description: body.description,
  })

  res.status(201).json({ reservation })
}
