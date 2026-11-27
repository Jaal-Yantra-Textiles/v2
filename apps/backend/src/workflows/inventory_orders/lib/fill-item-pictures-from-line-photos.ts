import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { RAW_MATERIAL_MODULE } from "../../../modules/raw_material"
import type { ProposedLine } from "../../../modules/inventory_orders/lib/order-changes"
import { cleanPhotoUrls } from "./create-sample-material-lines"

/**
 * #2659 — photos a partner attached to an EXISTING line land on the line's
 * `metadata.photos` (unchanged). On approval they ALSO become the item's
 * picture, but only where it has none:
 *
 *   - the inventory item gets `thumbnail` = the first photo, and its
 *     `metadata.photo_pending` flag is cleared (that flag means "we are
 *     waiting for a photo of this cloth");
 *   - its raw material's `media` gets every photo appended, keeping what was
 *     there.
 *
 * 🔴 An existing thumbnail is NEVER overwritten. A partner's phone photo of a
 * folded bolt is evidence for this order; it is not a better catalogue
 * picture than one somebody chose, and replacing it would change what the
 * store shows without anyone deciding that.
 *
 * Written through the services directly — not `syncInventoryThumbnailStep`,
 * which would point the thumbnail at the raw material's FIRST media entry,
 * an older photo when media already held one.
 */

/**
 * PURE: `media` with `urls` appended, whatever shape it was stored in (see
 * `firstMediaUrl` for the history). Nothing already there is dropped.
 */
export const appendMediaUrls = (media: unknown, urls: string[]): unknown => {
  const has = (list: unknown[], url: string) =>
    list.some((e) =>
      typeof e === "string" ? e === url : !!e && typeof e === "object" && (e as any).url === url
    )
  const append = (list: unknown[]) => {
    const out = [...list]
    for (const u of urls) if (!has(out, u)) out.push(u)
    return out
  }
  if (media == null) return { files: [...urls] }
  if (Array.isArray(media)) return append(media)
  if (typeof media === "object") {
    const obj = media as Record<string, unknown>
    if (Array.isArray(obj.files)) return { ...obj, files: append(obj.files) }
    // A single object (`{ url }` etc.): keep it as the first entry.
    return { files: append([obj]) }
  }
  if (typeof media === "string") return { files: append([media]) }
  return { files: [...urls] }
}

type Prior = {
  itemId: string
  thumbnail: string | null
  metadata: Record<string, unknown> | null
  rawMaterial?: { id: string; media: unknown }
}

export const fillItemPicturesFromLinePhotosStep = createStep(
  "fill-inventory-item-pictures-from-line-photos",
  async (input: { orderId: string; lines: ProposedLine[] }, { container }) => {
    const photosByLine = new Map<string, string[]>()
    for (const l of input.lines ?? []) {
      if (!l?.id || l.remove) continue
      const photos = cleanPhotoUrls(l.photos)
      if (photos.length) photosByLine.set(String(l.id), photos)
    }
    const priors: Prior[] = []
    if (!photosByLine.size) {
      return new StepResponse({ filled: 0 }, priors)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "orderlines.id",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.thumbnail",
        "orderlines.inventory_items.metadata",
        "orderlines.inventory_items.raw_materials.id",
        "orderlines.inventory_items.raw_materials.media",
      ],
      filters: { id: input.orderId },
    })

    const inventory: any = container.resolve(Modules.INVENTORY)
    const rawMaterials: any = container.resolve(RAW_MATERIAL_MODULE)
    const done = new Set<string>()

    for (const ol of (data?.[0]?.orderlines ?? []) as any[]) {
      const photos = photosByLine.get(String(ol?.id))
      const item = (ol?.inventory_items ?? [])[0]
      if (!photos || !item?.id || done.has(item.id)) continue
      done.add(item.id)
      if (item.thumbnail) continue // never overwrite a chosen picture

      const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : null
      const rms = item.raw_materials
      const rm = Array.isArray(rms) ? rms[0] : rms
      priors.push({
        itemId: item.id,
        thumbnail: null,
        metadata: item.metadata ?? null,
        ...(rm?.id ? { rawMaterial: { id: rm.id, media: rm.media ?? null } } : {}),
      })

      // Inventory metadata updates MERGE: an omitted key survives. Medusa
      // deletes a key whose value is "", which is how the flag is cleared.
      await inventory.updateInventoryItems({
        id: item.id,
        thumbnail: photos[0],
        ...(metadata && "photo_pending" in metadata ? { metadata: { photo_pending: "" } } : {}),
      })
      if (rm?.id) {
        await rawMaterials.updateRawMaterials([
          { id: rm.id, media: appendMediaUrls(rm.media, photos) },
        ])
      }
    }

    return new StepResponse({ filled: priors.length }, priors)
  },
  async (priors: Prior[] | undefined, { container }) => {
    if (!priors?.length) return
    const inventory: any = container.resolve(Modules.INVENTORY)
    const rawMaterials: any = container.resolve(RAW_MATERIAL_MODULE)
    for (const p of priors) {
      await inventory.updateInventoryItems({ id: p.itemId, thumbnail: p.thumbnail, metadata: p.metadata })
      if (p.rawMaterial) {
        await rawMaterials.updateRawMaterials([{ id: p.rawMaterial.id, media: p.rawMaterial.media }])
      }
    }
  }
)
