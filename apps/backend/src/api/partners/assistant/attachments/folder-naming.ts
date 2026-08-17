/**
 * Naming for the per-partner assistant upload folder.
 *
 * Kept pure and dependency-free so it can be unit-tested without a container,
 * and so the slug rule lives in exactly one place — the slug is the lookup key
 * for "does this partner already have a folder?", so if it were derived
 * differently in two places a partner would silently accumulate folders.
 */

/** Marker written to folder.metadata so ownership survives independently of
 *  the person→folder link the shared-folders UI reads. */
export const PARTNER_ASSISTANT_FOLDER_PURPOSE = "partner_assistant_uploads"

/**
 * Deterministic, unique slug for a partner's assistant folder.
 *
 * Derived from the partner ID rather than the name: `folder.slug` is UNIQUE,
 * and two partners can share a display name ("Pashmina Co") while a partner may
 * also rename itself later. An id-derived slug is stable across both.
 */
export const assistantFolderSlug = (partnerId: string): string =>
  `partner-assistant-${String(partnerId).trim()}`

/** Human-facing folder name. Falls back when a partner has no name set. */
export const assistantFolderName = (partnerName?: string | null): string => {
  const trimmed = String(partnerName ?? "").trim()
  return trimmed ? `Assistant uploads — ${trimmed}` : "Assistant uploads"
}

/** Root-level path for the folder, matching createFolderStep's convention. */
export const assistantFolderPath = (partnerId: string): string =>
  `/${assistantFolderSlug(partnerId)}`
