import { firstMediaUrl } from "./first-media-url"

/**
 * Decide whether to mirror a raw material's primary image onto its linked
 * inventory item's `thumbnail`, returning the url to set or `undefined` to skip.
 *
 * Used by the manual photo→raw-material bind route (#730/#737), whose append
 * path writes `raw_materials.media` directly — bypassing the create/update
 * workflows that run `syncInventoryThumbnailStep` (#739) — so the linked
 * inventory item's thumbnail would otherwise stay null until the #457 backfill.
 *
 * Decision (reuses {@link firstMediaUrl} for shape parsing — no new parser):
 *  - skip when the media blob yields no usable url
 *  - skip when the inventory item already shows that exact url (idempotent)
 *  - by default skip when the item already has a (different) thumbnail so a
 *    manually-set image is never clobbered; pass `overwrite: true` to replace it
 */
export function pickInventoryThumbnail(
  current: unknown,
  media: unknown,
  opts: { overwrite?: boolean } = {}
): string | undefined {
  const url = firstMediaUrl(media)
  if (!url) {
    return undefined
  }

  const hasCurrent = typeof current === "string" && current.trim().length > 0
  if (hasCurrent) {
    if ((current as string).trim() === url) {
      return undefined // already points at this image — idempotent no-op
    }
    if (!opts.overwrite) {
      return undefined // don't clobber a manually-set thumbnail
    }
  }

  return url
}
