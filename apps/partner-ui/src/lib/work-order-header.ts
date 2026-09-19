/**
 * Pure summarisers for the work-order header card (#2019 / #2018 follow-up).
 *
 * The header is the one card a partner always sees — it carries the order
 * number and never collapses. Everything below it lives behind
 * `RunDetailsReveal`, which is deliberate: an OFFERED run should show the
 * accept/decline decision and not much else. So anything promoted up here has
 * to earn it by helping that decision, and has to be cheap to render.
 */

export type HeaderThumbnails<T> = {
  /** The ones to render. */
  shown: T[]
  /** How many more exist, for a "+N" chip. 0 when everything fits. */
  overflow: number
}

/**
 * Take the first `max` media for the header strip.
 *
 * 🔑 `overflow` is the REMAINDER, not the total. A "+9" chip beside 5 visible
 * thumbnails on a 9-image design would be the obvious off-by-one, and it reads
 * as plausible — which is what would make it survive review.
 */
export const splitThumbnails = <T>(
  media: readonly T[] | null | undefined,
  max = 5
): HeaderThumbnails<T> => {
  const all = Array.isArray(media) ? media : []
  if (max <= 0) {
    return { shown: [], overflow: all.length }
  }
  return {
    shown: all.slice(0, max),
    overflow: Math.max(0, all.length - max),
  }
}

export type BomSummary = {
  /** Lines on the design's bill of materials. */
  materialCount: number
  /** How many carry a planned quantity — i.e. someone has said how much. */
  plannedCount: number
  /** How many have had consumption recorded against them. */
  consumedCount: number
}

/**
 * What the header can honestly say about the bill of materials.
 *
 * 🔴 Deliberately NOT "N linked to this run". The BOM hangs off the DESIGN
 * (`usePartnerDesignInventory(designId)`) and carries no run reference at all —
 * `PartnerDesignInventoryItem` has `planned_quantity`, `consumed_quantity` and
 * `location_id`, and nothing that names a production run. A design produced
 * twice has one BOM and two runs.
 *
 * So a "linked to this run" count would be a relationship invented at the
 * point of display, which is the worst place to invent one: it looks derived.
 * The counts below are all design-scoped, and the header says so.
 */
export const summarizeBomLines = (
  lines: ReadonlyArray<Record<string, any>> | null | undefined
): BomSummary => {
  const rows = Array.isArray(lines) ? lines : []
  let plannedCount = 0
  let consumedCount = 0

  for (const line of rows) {
    if (!line || typeof line !== "object") {
      continue
    }
    // `> 0`, not `!= null`: a planned quantity of 0 is a line nobody has
    // actually planned, and `Number(null)` is 0 — so a null-guard alone would
    // count every unplanned line as planned.
    if (Number(line.planned_quantity) > 0) {
      plannedCount += 1
    }
    if (Number(line.consumed_quantity) > 0) {
      consumedCount += 1
    }
  }

  return { materialCount: rows.length, plannedCount, consumedCount }
}
