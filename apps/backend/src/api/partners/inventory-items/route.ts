import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext, getPartnerStore, tryGetPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  const locationId = store.default_location_id

  if (!locationId) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  const qv = (req.validatedQuery ?? req.query ?? {}) as Record<string, any>
  const q = typeof qv.q === "string" ? qv.q.trim() : ""
  const limit = Number.isFinite(Number(qv.limit)) ? Number(qv.limit) : 20
  const offset = Number.isFinite(Number(qv.offset)) ? Number(qv.offset) : 0

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  // Get inventory levels at the partner's location to find their item IDs
  const [levels] = await inventoryService.listAndCountInventoryLevels(
    { location_id: locationId },
    { take: 1000 }
  )

  const itemIds = [...new Set((levels || []).map((l: any) => l.inventory_item_id).filter(Boolean))] as string[]

  if (itemIds.length === 0) {
    return res.json({ inventory_items: [], count: 0, offset, limit })
  }

  // Fetch full inventory items with their levels (filtered to partner's location)
  const [items] = await inventoryService.listAndCountInventoryItems(
    { id: itemIds },
    { take: itemIds.length, relations: ["location_levels"] }
  )

  // Filter location_levels to partner's location AND aggregate totals onto
  // the item itself. listAndCountInventoryItems doesn't populate the
  // top-level stocked/reserved/incoming quantities (they come back null),
  // but the partner UI list + detail read them from the item directly.
  const scoped = (items || []).map((item: any) => {
    const levels = (item.location_levels || []).filter(
      (ll: any) => ll.location_id === locationId
    )
    const sum = (field: "stocked_quantity" | "reserved_quantity" | "incoming_quantity") =>
      levels.reduce((acc: number, lvl: any) => acc + (Number(lvl?.[field]) || 0), 0)

    return {
      ...item,
      location_levels: levels,
      stocked_quantity: sum("stocked_quantity"),
      reserved_quantity: sum("reserved_quantity"),
      incoming_quantity: sum("incoming_quantity"),
    }
  })

  // Apply free-text search (q) against sku/title — the inventory service's
  // location-scoped fetch above can't filter on these, so we post-filter
  // in-app (same approach as the raw-materials route). Without this the
  // partner UI search box silently returns the full list (#484).
  const needle = q.toLowerCase()
  const matched = needle
    ? scoped.filter((item: any) => {
        const candidates: Array<string | undefined> = [item?.sku, item?.title]
        return candidates.some(
          (c) => typeof c === "string" && c.toLowerCase().includes(needle)
        )
      })
    : scoped

  // Respect offset/limit pagination so the UI's page controls work.
  const safeOffset = offset > 0 ? offset : 0
  const safeLimit = limit > 0 ? limit : matched.length
  const paginated = matched.slice(safeOffset, safeOffset + safeLimit)

  res.json({
    inventory_items: paginated,
    count: matched.length,
    offset: safeOffset,
    limit: safeLimit,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const item = await inventoryService.createInventoryItems(body)

  // Auto-create a level at the partner's location
  try {
    const { store } = await getPartnerStore(req.auth_context, req.scope)
    if (store.default_location_id) {
      await inventoryService.createInventoryLevels([{
        inventory_item_id: item.id,
        location_id: store.default_location_id,
        stocked_quantity: 0,
      }])
    }
  } catch {
    // Non-critical
  }

  res.status(201).json({ inventory_item: item })
}
