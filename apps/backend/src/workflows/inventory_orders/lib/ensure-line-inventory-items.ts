import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework/types"
import { enableInventoryTracking } from "../../products/bulk-update-products"

/**
 * Give an order line's variant the inventory record core never created for it.
 *
 * #1662. A partner's fabric or finished good is often sold as a product whose
 * variants have `manage_inventory: false` — and such a variant has NO inventory
 * item row at all. Core can only ever turn tracking off, so nothing downstream
 * can conjure one. The founder's call (2026-08-30): tracking is established at
 * OUR end, silently, at the moment we place the inventory order — picking it is
 * the intent, so there is no second confirmation step.
 *
 * Reuses `enableInventoryTracking` from `bulk-update-products` rather than
 * carrying a second copy of it (#1654's two-homes lesson). It is idempotent:
 * a variant that already has an item gets its existing id back.
 *
 * ⚠️ Deliberately NOT compensated. If a later step fails and the order rolls
 * back, the inventory item stays. Deleting it would destroy a record other
 * lines, levels or reservations may already point at, to undo something that
 * costs nothing to leave — and a retry finds it and reuses it.
 */
export type LineItemRef = {
  inventory_item_id?: string | null
  variant_id?: string | null
}

export type EnsuredLine = {
  inventory_item_id: string
  /** Set only when this call is what made the variant trackable. */
  enabled_variant_id?: string
  actions?: string[]
}

export const ensureLineInventoryItems = async <T extends LineItemRef>(
  container: MedusaContainer,
  lines: T[],
  options: { stock_location_id?: string | null } = {}
): Promise<{ lines: (T & EnsuredLine)[]; enabled_variant_ids: string[] }> => {
  const needsVariant = lines.filter((l) => !l.inventory_item_id && l.variant_id)

  if (!needsVariant.length) {
    // Cast, never coerce: a line with neither reference is a validator failure,
    // and String(undefined) would smuggle the literal "undefined" through as an
    // id that looks real until a link write silently matches nothing.
    return {
      lines: lines as (T & EnsuredLine)[],
      enabled_variant_ids: [],
    }
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const variantIds = Array.from(
    new Set(needsVariant.map((l) => String(l.variant_id)))
  )

  // Same relation names as bulk-update-products (`variants.inventory_items…`),
  // read through `product` — the entry point those names are proven against.
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.sku",
      "variants.title",
      "variants.manage_inventory",
      "variants.hs_code",
      "variants.origin_country",
      "variants.mid_code",
      "variants.material",
      "variants.weight",
      "variants.length",
      "variants.height",
      "variants.width",
      "variants.inventory_items.inventory_item_id",
      "variants.inventory_items.inventory.id",
    ],
    filters: { variants: { id: variantIds } },
  })

  const variantsById = new Map<string, any>()
  for (const product of (Array.isArray(data) ? data : []) as any[]) {
    for (const variant of (product?.variants ?? []) as any[]) {
      if (variant?.id) {
        variantsById.set(String(variant.id), variant)
      }
    }
  }

  const resolved = new Map<string, string>()
  const enabled: string[] = []
  const actionsByVariant = new Map<string, string[]>()

  for (const variantId of variantIds) {
    const variant = variantsById.get(variantId)
    if (!variant) {
      throw new Error(
        `Order line references variant ${variantId}, which does not exist.`
      )
    }

    const actions: string[] = []
    const itemId = await enableInventoryTracking(container, variant, actions)

    if (!itemId) {
      throw new Error(
        `Could not establish an inventory item for variant ${variantId}. The order line cannot be written without one.`
      )
    }

    resolved.set(variantId, itemId)
    actionsByVariant.set(variantId, actions)
    if (actions.length) {
      enabled.push(variantId)
    }
  }

  // Seed a level at the destination so the newly tracked variant is visible at
  // our location straight away. Quantity 0 on purpose: nothing has been
  // received yet, and the receipt on completion is what posts the stock. Any
  // other seed would be inventing goods we do not hold.
  const locationId = options.stock_location_id
  if (locationId && enabled.length) {
    const inventoryService: any = container.resolve(Modules.INVENTORY)
    for (const variantId of enabled) {
      const itemId = resolved.get(variantId)!
      try {
        const levels = await inventoryService.listInventoryLevels({
          inventory_item_id: itemId,
          location_id: locationId,
        })
        if (!(levels as any[])?.length) {
          await inventoryService.createInventoryLevels([
            {
              inventory_item_id: itemId,
              location_id: locationId,
              stocked_quantity: 0,
            },
          ])
          actionsByVariant.get(variantId)?.push("create_level")
        }
      } catch (err) {
        // Visibility only. The completion receipt creates the level if it is
        // still missing, so losing this must not cost the buyer the order.
        console.warn(
          `[inventory-order] could not seed a 0 level for ${itemId} at ${locationId}: ${
            (err as any)?.message || err
          }`
        )
      }
    }
  }

  return {
    lines: lines.map((l) => {
      if (l.inventory_item_id) {
        return { ...l, inventory_item_id: String(l.inventory_item_id) }
      }
      if (!l.variant_id) {
        return l as T & EnsuredLine
      }
      const variantId = String(l.variant_id)
      return {
        ...l,
        inventory_item_id: resolved.get(variantId)!,
        enabled_variant_id: enabled.includes(variantId) ? variantId : undefined,
        actions: actionsByVariant.get(variantId),
      }
    }),
    enabled_variant_ids: enabled,
  }
}
