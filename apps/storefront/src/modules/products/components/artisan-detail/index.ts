import { HttpTypes } from "@medusajs/types"

// #859 S3 (#862): the artisan "made-to-order & maker story" detail, linked to a
// product on the backend and hydrated onto the store product via
// `fields=+artisan_detail.*`. Not part of the core StoreProduct type, so we
// read it defensively.
export type ArtisanDetail = {
  made_to_order?: boolean | null
  lead_time_days?: number | null
  lead_time_label?: string | null
  min_order_quantity?: number | null
  maker_story?: string | null
  // Grafted server-side from the owning partner's name (#859) — not a DB field.
  maker_name?: string | null
}

export function getArtisanDetail(
  product?: HttpTypes.StoreProduct | null
): ArtisanDetail | null {
  const detail = (product as any)?.artisan_detail
  if (!detail || typeof detail !== "object") return null
  return detail as ArtisanDetail
}

/**
 * Human-friendly preparation time. Prefers the partner's free-form label; else
 * derives an approximate "~N week(s)/day(s)" from lead_time_days. Returns null
 * when there's nothing to say.
 */
export function formatLeadTime(detail: ArtisanDetail | null): string | null {
  if (!detail) return null
  if (detail.lead_time_label && detail.lead_time_label.trim()) {
    return detail.lead_time_label.trim()
  }
  const days = detail.lead_time_days
  if (!days || days <= 0) return null
  if (days < 7) {
    return `~${days} day${days === 1 ? "" : "s"} to prepare`
  }
  const weeks = Math.round(days / 7)
  return `~${weeks} week${weeks === 1 ? "" : "s"} to prepare`
}
