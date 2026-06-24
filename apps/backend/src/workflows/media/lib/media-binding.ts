/**
 * Pure helpers for binding a media-gallery photo to a raw material.
 *
 * The source-of-truth for "which photo does this raw material show" is the
 * `raw_materials.media` json column, persisted in the canonical
 * `{ files: string[] }` shape (same contract the raw-material form, bulk-import,
 * and the design-inventory thumbnail readers — #728/#731/#733 — all use).
 * Keeping the bind tool writing into that column is what makes the photo render
 * bidirectionally everywhere a raw material is shown.
 *
 * These functions are intentionally pure (no IO) so the append/dedup/remove
 * logic is unit-testable in isolation.
 */

export type RawMaterialMedia = { files: string[] }

/**
 * Normalize whatever is stored in `raw_materials.media` into a clean, de-duped
 * `string[]` of urls. Tolerant of the historical shapes seen in the codebase:
 *   - `{ files: string[] }`            (canonical — form + bulk-import)
 *   - `string[]`                       (older rows)
 *   - `{ files: { url|file_path }[] }` (object entries)
 *   - `null` / malformed               → `[]`
 */
export function normalizeMediaFiles(media: unknown): string[] {
  if (!media) return []
  let arr: unknown[] = []
  if (Array.isArray(media)) {
    arr = media
  } else if (typeof media === "object" && Array.isArray((media as any).files)) {
    arr = (media as any).files
  } else {
    return []
  }

  const urls = arr
    .map((entry) => {
      if (typeof entry === "string") return entry
      if (entry && typeof entry === "object") {
        const obj = entry as any
        return obj.url ?? obj.file_path ?? null
      }
      return null
    })
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)

  // de-dupe while preserving insertion order
  return Array.from(new Set(urls))
}

/**
 * Append `url` to the media list idempotently. Returns the canonical
 * `{ files }` shape ready to persist. Re-binding the same url is a no-op.
 */
export function appendMediaFile(media: unknown, url: string): RawMaterialMedia {
  const files = normalizeMediaFiles(media)
  const clean = typeof url === "string" ? url.trim() : ""
  if (clean && !files.includes(clean)) {
    files.push(clean)
  }
  return { files }
}

/**
 * Remove `url` from the media list. Returns the canonical `{ files }` shape.
 */
export function removeMediaFile(media: unknown, url: string): RawMaterialMedia {
  const clean = typeof url === "string" ? url.trim() : ""
  const files = normalizeMediaFiles(media).filter((u) => u !== clean)
  return { files }
}

/** Whether `url` is currently bound on the given media json. */
export function isMediaBound(media: unknown, url: string): boolean {
  const clean = typeof url === "string" ? url.trim() : ""
  return normalizeMediaFiles(media).includes(clean)
}

/**
 * Display-only back-reference stamped onto the media_file's `metadata` so the
 * gallery can show "Bound to <raw material>" and offer unbind without a
 * json-contains query. NOT the source of truth — that stays in
 * `raw_materials.media`.
 */
export type MediaBindingRef = {
  bound_raw_material_id: string
  bound_raw_material_name?: string | null
  bound_sku?: string | null
}

export function stampBinding(
  metadata: unknown,
  ref: MediaBindingRef
): Record<string, any> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, any>) }
      : {}
  return {
    ...base,
    bound_raw_material_id: ref.bound_raw_material_id,
    bound_raw_material_name: ref.bound_raw_material_name ?? null,
    bound_sku: ref.bound_sku ?? null,
  }
}

export function clearBinding(metadata: unknown): Record<string, any> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, any>) }
      : {}
  // Medusa's module-service `update` MERGES the metadata json (it does not
  // replace it), so deleting keys here would leave the old values in place.
  // Null them out instead — readBinding() treats a null id as "not bound".
  base.bound_raw_material_id = null
  base.bound_raw_material_name = null
  base.bound_sku = null
  return base
}

export type MediaBinding = {
  raw_material_id: string
  raw_material_name: string | null
  sku: string | null
}

/** Read the display back-reference out of a media_file's metadata, if any. */
export function readBinding(metadata: unknown): MediaBinding | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }
  const m = metadata as Record<string, any>
  if (!m.bound_raw_material_id) return null
  return {
    raw_material_id: m.bound_raw_material_id,
    raw_material_name: m.bound_raw_material_name ?? null,
    sku: m.bound_sku ?? null,
  }
}
