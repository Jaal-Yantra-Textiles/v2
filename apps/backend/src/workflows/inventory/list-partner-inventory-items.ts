import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"

// #843 — the partner inventory listing, lifted out of
// `GET /partners/inventory-items` into a workflow so the admin inspection
// mirror (`GET /admin/partners/:id/inventory-items`) runs the SAME logic
// rather than re-deriving it. The route keeps auth and resolving WHICH stock
// location is the partner's; everything after that lives here.

export type ListPartnerInventoryItemsWorkflowInput = {
  /** The partner's stock location — the whole scoping rule for this surface. */
  locationId: string
  q?: string
  offset: number
  limit: number
}

/**
 * Every inventory item that has a level at the partner's location, with its
 * levels scoped to that location and the per-location totals aggregated onto
 * the item.
 *
 * `listAndCountInventoryItems` does NOT populate the top-level
 * stocked/reserved/incoming quantities (they come back null) but the partner UI
 * list AND detail read them off the item directly — hence the aggregation.
 */
export const resolvePartnerInventoryItemsStep = createStep(
  "resolve-partner-inventory-items",
  async (input: { locationId: string }, { container }) => {
    const inventoryService = container.resolve(Modules.INVENTORY) as any

    // Levels at the partner's location give us their item ids.
    const [levels] = await inventoryService.listAndCountInventoryLevels(
      { location_id: input.locationId },
      { take: 1000 }
    )

    const itemIds = [
      ...new Set(
        (levels || []).map((l: any) => l.inventory_item_id).filter(Boolean)
      ),
    ] as string[]

    if (itemIds.length === 0) {
      return new StepResponse([] as any[])
    }

    const [items] = await inventoryService.listAndCountInventoryItems(
      { id: itemIds },
      { take: itemIds.length, relations: ["location_levels"] }
    )

    const scoped = (items || []).map((item: any) => {
      const itemLevels = (item.location_levels || []).filter(
        (ll: any) => ll.location_id === input.locationId
      )
      const sum = (
        field: "stocked_quantity" | "reserved_quantity" | "incoming_quantity"
      ) =>
        itemLevels.reduce(
          (acc: number, lvl: any) => acc + (Number(lvl?.[field]) || 0),
          0
        )

      return {
        ...item,
        location_levels: itemLevels,
        stocked_quantity: sum("stocked_quantity"),
        reserved_quantity: sum("reserved_quantity"),
        incoming_quantity: sum("incoming_quantity"),
      }
    })

    return new StepResponse(scoped as any[])
  }
)

export const listPartnerInventoryItemsWorkflow = createWorkflow(
  "list-partner-inventory-items",
  (input: ListPartnerInventoryItemsWorkflowInput) => {
    const items = resolvePartnerInventoryItemsStep({
      locationId: input.locationId,
    })

    const output = transform({ items, input }, ({ items, input }) => {
      // Free-text search over sku/title. The location-scoped fetch above can't
      // filter on these, so it is matched in-app (same approach as the
      // raw-materials route). Without it the partner UI search box silently
      // returns the full list (#484).
      const needle = input.q?.trim().toLowerCase()
      const matched = needle
        ? (items as any[]).filter((item: any) =>
            [item?.sku, item?.title].some(
              (c) => typeof c === "string" && c.toLowerCase().includes(needle)
            )
          )
        : (items as any[])

      // Paginate AFTER filtering, so `count` is the total matched and the UI
      // pager is correct (#484).
      const safeOffset = input.offset > 0 ? input.offset : 0
      const safeLimit = input.limit > 0 ? input.limit : matched.length

      return {
        inventory_items: matched.slice(safeOffset, safeOffset + safeLimit),
        count: matched.length,
        offset: safeOffset,
        limit: safeLimit,
      }
    })

    return new WorkflowResponse(output)
  }
)

export default listPartnerInventoryItemsWorkflow
