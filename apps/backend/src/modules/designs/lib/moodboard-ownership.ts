/**
 * Who owns which board, and what to show when nobody does yet (#2017).
 *
 * PURE. The routes, the admin surface and the partner surface all decide the
 * same question — "which of these boards is mine, which are theirs" — and a
 * second copy of that rule drifting is how an admin and a partner end up
 * looking at the same row again.
 */

export type MoodboardOwner =
  | { type: "core" }
  | { type: "partner"; partnerId: string }

export type MoodboardRow = {
  id: string
  owner_type: string
  partner_id?: string | null
  title?: string | null
  scene?: unknown
  thumbnail_url?: string | null
  updated_at?: string | Date | null
}

/** A board as a surface should present it, own or not. */
export type ResolvedBoard = MoodboardRow & {
  /** Is this the viewer's own board (editable) or someone else's (read-only)? */
  is_own: boolean
  /**
   * True when this board is not a row at all but the legacy `design.moodboard`
   * blob, shown so an unmigrated design does not read as empty.
   */
  is_legacy: boolean
}

export const LEGACY_BOARD_ID = "legacy"

const sceneHasElements = (scene: unknown): boolean => {
  const s = scene as { elements?: unknown } | null
  return !!(s && typeof s === "object" && Array.isArray(s.elements) && s.elements.length > 0)
}

const ownsRow = (row: MoodboardRow, viewer: MoodboardOwner): boolean => {
  if (viewer.type === "core") {
    return row.owner_type === "core"
  }
  return row.owner_type === "partner" && String(row.partner_id) === viewer.partnerId
}

export type ResolvedBoards = {
  /** The viewer's own board, or null when they have not started one. */
  own: ResolvedBoard | null
  /** Everyone else's, read-only, newest-looking first is the caller's business. */
  others: ResolvedBoard[]
  /**
   * True when `own`/`others` includes the legacy blob rather than a row.
   * Surfaces should say so — "this board predates per-owner boards" is a
   * different fact from "this is your board".
   */
  usedLegacyFallback: boolean
}

/**
 * Split the design's boards into the viewer's own and everyone else's.
 *
 * 🔴 THE LEGACY BLOB IS THE FALLBACK, AND ONLY WHEN THERE ARE NO ROWS.
 *
 * An empty row read and "this design has no boards" are the same value and
 * different facts — a design written before #2017, or one the backfill skipped,
 * has its scene in `design.moodboard` and no rows at all. Believing the empty
 * read would show a populated board as blank and invite the owner to start
 * over on top of their own work.
 *
 * The blob is presented as the CORE board, because that is what it was: one
 * column everybody shared, administered from the admin side. A partner viewing
 * it therefore sees it under `others`, read-only — which is the conservative
 * direction. The alternative, treating it as theirs, would hand a partner edit
 * rights over a scene an admin may have authored.
 *
 * Once ANY row exists the blob is ignored entirely. A half-migrated design
 * showing both would double every frame.
 */
export const resolveBoards = (
  rows: MoodboardRow[] | null | undefined,
  legacyScene: unknown,
  viewer: MoodboardOwner
): ResolvedBoards => {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)

  if (list.length === 0) {
    if (!sceneHasElements(legacyScene)) {
      return { own: null, others: [], usedLegacyFallback: false }
    }
    const legacy: ResolvedBoard = {
      id: LEGACY_BOARD_ID,
      owner_type: "core",
      partner_id: null,
      title: null,
      scene: legacyScene,
      is_own: viewer.type === "core",
      is_legacy: true,
    }
    return {
      own: legacy.is_own ? legacy : null,
      others: legacy.is_own ? [] : [legacy],
      usedLegacyFallback: true,
    }
  }

  let own: ResolvedBoard | null = null
  const others: ResolvedBoard[] = []
  for (const row of list) {
    const resolved: ResolvedBoard = { ...row, is_own: ownsRow(row, viewer), is_legacy: false }
    if (resolved.is_own && !own) {
      own = resolved
    } else {
      others.push(resolved)
    }
  }

  return { own, others, usedLegacyFallback: false }
}

/**
 * May this viewer write to this board?
 *
 * Ownership only. Whether the caller may touch the DESIGN at all is a separate
 * question, answered upstream by `assertPartnerCanAuthorDesign` — this decides
 * only which of the design's boards is theirs once they are through that door.
 * Keeping the two apart is what stops "can author the design" quietly becoming
 * "can overwrite the admin's board", which is the bug the entity exists to fix.
 */
export const canWriteBoard = (
  row: MoodboardRow | null | undefined,
  viewer: MoodboardOwner
): boolean => {
  if (!row) {
    return false
  }
  return ownsRow(row, viewer)
}
