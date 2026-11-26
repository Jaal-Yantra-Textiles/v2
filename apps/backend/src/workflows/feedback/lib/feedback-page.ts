// Pure helpers for the public buyer feedback page (`/feedback/:id` on the
// storefront, backed by GET/POST /web/feedback/:id). No container deps so the
// "what may a stranger holding the link see / do" rules are unit-testable.
//
// The link is the credential: the feedback id is a Medusa ULID (48-bit time +
// 80 random bits), so it cannot be guessed or walked. What it reveals is kept
// to what the buyer needs to recognise their order: item titles, variant,
// thumbnail, quantity and the order number. Never the email, address, phone,
// prices or the customer's name.

import { normalizeRatingValue, type RatingEnum } from "./artwork-feedback"

export const FEEDBACK_COMMENT_MAX = 2000

export type FeedbackRowLike = {
  id: string
  order_id?: string | null
  rating?: string | null
  comment?: string | null
  status?: string | null
  answered_at?: Date | string | null
  chosen_artwork_id?: string | null
  artwork_affinity?: string | null
}

/**
 * Only a feedback request ABOUT AN ORDER is a buyer's page. The same table also
 * holds partner/task/admin feedback, which must never be readable or writable
 * through a public link.
 */
export function isBuyerFeedbackRequest(row: FeedbackRowLike | null | undefined): boolean {
  return !!row?.id && !!(row.order_id && String(row.order_id).trim())
}

export function isFeedbackAnswered(row: FeedbackRowLike | null | undefined): boolean {
  return !!row?.answered_at
}

export type PublicFeedbackItem = {
  title: string
  variant_title: string | null
  thumbnail: string | null
  quantity: number
}

export type PublicFeedbackView = {
  feedback: {
    id: string
    /** Admin review state; kept for back-compat, not shown to the buyer. */
    status: string | null
    answered: boolean
    answered_at: string | null
    /** Null until answered: the column defaults to "three", which is not an answer. */
    rating: RatingEnum | null
    comment: string | null
    chosen_artwork_id: string | null
    artwork_affinity: string | null
  }
  order: { display_id: number | string | null; items: PublicFeedbackItem[] } | null
  store: { name: string | null; url: string | null }
}

const toIso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function buildPublicFeedbackView(input: {
  feedback: FeedbackRowLike
  order?: {
    display_id?: number | string | null
    items?: Array<{
      title?: string | null
      product_title?: string | null
      variant_title?: string | null
      thumbnail?: string | null
      quantity?: number | string | null
    }> | null
  } | null
  store?: { name?: string | null; url?: string | null } | null
}): PublicFeedbackView {
  const f = input.feedback
  const answered = isFeedbackAnswered(f)
  const items: PublicFeedbackItem[] = (input.order?.items ?? [])
    .filter(Boolean)
    .map((it) => ({
      title: String(it.product_title || it.title || "Your item"),
      variant_title:
        it.variant_title && it.variant_title !== "Default variant" ? it.variant_title : null,
      thumbnail: it.thumbnail || null,
      quantity: Number(it.quantity) || 1,
    }))

  return {
    feedback: {
      id: f.id,
      status: f.status ?? null,
      answered,
      answered_at: toIso(f.answered_at),
      rating: answered ? normalizeRatingValue(f.rating) ?? null : null,
      comment: answered ? f.comment ?? null : null,
      chosen_artwork_id: f.chosen_artwork_id ?? null,
      artwork_affinity: f.artwork_affinity ?? null,
    },
    order: input.order
      ? { display_id: input.order.display_id ?? null, items }
      : null,
    store: {
      name: input.store?.name ?? null,
      url: input.store?.url || null,
    },
  }
}

export type FeedbackSubmission =
  | { ok: true; rating: RatingEnum; comment: string | null }
  | { ok: false; reason: string }

/**
 * Validate the buyer's answer. A rating (1..5 or "one".."five") is required —
 * it is what makes the request "answered". The comment is optional, trimmed,
 * and capped so the column can't be used as free storage.
 */
export function parseFeedbackSubmission(body: unknown): FeedbackSubmission {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const rating = normalizeRatingValue(b.rating)
  if (!rating) {
    return { ok: false, reason: "Please choose a rating from 1 to 5." }
  }
  let comment: string | null = null
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") {
      return { ok: false, reason: "The comment must be text." }
    }
    const t = b.comment.trim()
    if (t.length > FEEDBACK_COMMENT_MAX) {
      return {
        ok: false,
        reason: `Please keep the comment under ${FEEDBACK_COMMENT_MAX} characters.`,
      }
    }
    comment = t || null
  }
  return { ok: true, rating, comment }
}
