import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { IInventoryService } from "@medusajs/types"
import { firstMediaUrl } from "../../../utils/first-media-url"

type SyncInventoryThumbnailInput = {
  /** Inventory item to patch. If omitted, resolved from `rawMaterialId` via the link. */
  inventoryId?: string
  /** Used to resolve the linked inventory item when `inventoryId` is not supplied. */
  rawMaterialId?: string
  /** The raw material `media` blob — first usable URL becomes the thumbnail. */
  media?: unknown
}

type Compensation = { inventoryId: string; previousThumbnail: string | null } | null

type SyncResult = {
  skipped: boolean
  reason?: string
  inventoryId?: string
  thumbnail?: string
}

/**
 * Mirror a raw material's primary image onto its linked inventory item's
 * `thumbnail`. The inventory item's own `thumbnail` is otherwise never
 * populated — the actual image lives in `raw_material.media` — so the admin
 * inventory table and storefront have nothing to show. Runs on raw-material
 * create/update whenever a `media` blob is present; a no-op (no write) when the
 * media yields no URL, when the thumbnail already matches, or when the linked
 * inventory item can't be resolved.
 */
export const syncInventoryThumbnailStep = createStep(
  "sync-inventory-thumbnail",
  async (input: SyncInventoryThumbnailInput, { container }) => {
    const url = firstMediaUrl(input.media)
    if (!url) {
      return new StepResponse<SyncResult, Compensation>(
        { skipped: true, reason: "no-media-url" },
        null
      )
    }

    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Resolve the inventory item — directly, or via the raw-material link.
    let inventoryId = input.inventoryId
    if (!inventoryId && input.rawMaterialId) {
      try {
        const { data: links } = await query.graph({
          entity: "inventory_item_raw_materials",
          filters: { raw_materials_id: input.rawMaterialId },
          fields: ["inventory_item_id"],
        })
        inventoryId = links?.[0]?.inventory_item_id
      } catch {
        // Link may not exist yet — nothing to patch.
      }
    }

    if (!inventoryId) {
      return new StepResponse<SyncResult, Compensation>(
        { skipped: true, reason: "no-inventory-item" },
        null
      )
    }

    const inventoryItem = await inventoryService.retrieveInventoryItem(inventoryId)
    const previousThumbnail = (inventoryItem.thumbnail as string | null) ?? null

    // Idempotent: nothing to do when it already points at this image.
    if (previousThumbnail === url) {
      return new StepResponse<SyncResult, Compensation>(
        { skipped: true, reason: "unchanged" },
        null
      )
    }

    await inventoryService.updateInventoryItems({ id: inventoryId, thumbnail: url })

    return new StepResponse<SyncResult, Compensation>(
      { skipped: false, inventoryId, thumbnail: url },
      { inventoryId, previousThumbnail }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    await inventoryService.updateInventoryItems({
      id: compensation.inventoryId,
      thumbnail: compensation.previousThumbnail as any,
    })
  }
)
