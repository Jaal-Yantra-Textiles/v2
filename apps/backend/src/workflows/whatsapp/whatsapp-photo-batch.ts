/**
 * #2138 — a photo is not a product offer, and a burst of photos is one event.
 *
 * ## What this replaces
 *
 * `seed-partner-product-create-flow.ts` mints a DRAFT product on:
 *
 *     partner_id != null && type in (image, document) && caption.length > 0
 *
 * Any captioned photo from a verified partner becomes a product. Nothing reads
 * what the caption says, whether we asked for a photo, or what the conversation
 * was about — so the pipeline asks "what product is this?", a question that
 * PRESUPPOSES the photo is a product offer. When the premise is wrong the
 * extractor answers confidently anyway: that is how a FABRIC was classified
 * `trousers` at confidence 1.00. No threshold fixes a false premise.
 *
 * Partners photograph stock we asked to see, fabric they want to sell US,
 * progress on a run, defects, bank slips and their workshop. One rule cannot
 * tell those apart from the image, and it should not try.
 *
 * So: intent comes from STATED context, and where there is none, we ask.
 *
 * ## Why a batch, and not one question per photo
 *
 * Partners send photos the way people do — eight in thirty seconds, one thumb,
 * no captions. Asking per photo means eight questions, which is worse than the
 * guessing it replaces.
 *
 * So a photo does not trigger the question. It joins a batch, and the batch is
 * asked about ONCE, after the partner has stopped sending. "Stopped" is a quiet
 * period since the last photo — the only signal available, because WhatsApp
 * does not tell us a burst has ended.
 *
 * 🔑 The wait is measured from the LAST photo, not the first. A partner still
 * uploading at 90 seconds has not finished; restarting the clock on each photo
 * is what makes "wait for them" mean what it says.
 */

/** How long the partner must be quiet before we treat a burst as finished. */
export const PHOTO_BATCH_QUIET_MS = 90_000

/**
 * How long a batch can stay open before we ask anyway.
 *
 * Without this a partner who sends one photo every minute for an hour is never
 * asked — each photo pushes the quiet window out and the batch grows forever.
 * The ceiling is measured from the FIRST photo, so a genuinely long upload
 * still gets one question rather than none.
 */
export const PHOTO_BATCH_MAX_AGE_MS = 10 * 60_000

export type PhotoBatch = {
  /** `messaging_message` ids, in arrival order. */
  message_ids: string[]
  /** ISO — when the first photo of this batch arrived. */
  first_at: string
  /** ISO — when the most recent photo arrived. Resets the quiet window. */
  last_at: string
  /** ISO — when we asked what the photos are for. Set once; never re-asked. */
  asked_at?: string | null
}

/**
 * The context an admin (or an explicit partner action) has already established,
 * which makes asking unnecessary.
 *
 * 🔴 `expires_at` is required rather than optional. A context set three weeks
 * ago silently reinterpreting today's photos is the same defect as the reminder
 * slot in #2122 — stale state deciding a live action — and an optional expiry
 * is one forgotten call away from permanent.
 */
export type PhotoContext = {
  kind: string
  note?: string | null
  set_by?: string | null
  set_at: string
  expires_at: string
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * PURE: is this context still speaking about now? Exported for tests.
 *
 * An unparseable or missing `expires_at` reads as EXPIRED, not as forever. A
 * context we cannot date is a context we cannot trust, and the failure that
 * matters is acting on a stale one.
 */
export function isPhotoContextLive(
  ctx: PhotoContext | null | undefined,
  now: Date = new Date()
): boolean {
  if (!ctx?.kind) return false
  const exp = ms(ctx.expires_at)
  if (exp == null) return false
  return exp > now.getTime()
}

/**
 * PURE: fold a newly-arrived photo into the batch. Exported for tests.
 *
 * A photo arriving AFTER we asked starts a fresh batch — the partner is
 * answering the previous question with more photos, or has moved on to a new
 * subject, and either way the old batch's question has already been put.
 */
export function recordPhoto(
  batch: PhotoBatch | null | undefined,
  messageId: string,
  now: Date = new Date()
): PhotoBatch {
  const iso = now.toISOString()

  if (!batch || batch.asked_at) {
    return { message_ids: [messageId], first_at: iso, last_at: iso, asked_at: null }
  }

  // Idempotent on message id: Meta re-delivers a webhook after a timeout, and
  // counting one photo twice would make a batch of one look like a burst.
  const ids = batch.message_ids.includes(messageId)
    ? batch.message_ids
    : [...batch.message_ids, messageId]

  return {
    message_ids: ids,
    first_at: batch.first_at || iso,
    last_at: iso,
    asked_at: null,
  }
}

export type BatchDecision =
  | { action: "skip"; reason: "no_batch" | "already_asked" }
  | { action: "wait"; reason: "still_sending"; photos: number }
  | { action: "ask"; reason: "settled" | "max_age"; photos: number }

/**
 * PURE: should we ask about this batch yet? Exported for tests.
 *
 * Deliberately has no opinion about WHAT to ask or whether a context exists —
 * a caller that already knows the purpose never gets here. This answers only
 * "has the partner finished sending".
 */
export function decidePhotoBatchAction(
  batch: PhotoBatch | null | undefined,
  now: Date = new Date(),
  quietMs: number = PHOTO_BATCH_QUIET_MS,
  maxAgeMs: number = PHOTO_BATCH_MAX_AGE_MS
): BatchDecision {
  if (!batch || !batch.message_ids?.length) {
    return { action: "skip", reason: "no_batch" }
  }
  if (batch.asked_at) {
    return { action: "skip", reason: "already_asked" }
  }

  const photos = batch.message_ids.length
  const nowMs = now.getTime()
  const last = ms(batch.last_at)
  const first = ms(batch.first_at)

  // An undateable batch is asked about rather than held forever — the photos
  // exist and the partner is waiting, which is the worse thing to get wrong.
  if (last == null) {
    return { action: "ask", reason: "settled", photos }
  }

  if (first != null && nowMs - first >= maxAgeMs) {
    return { action: "ask", reason: "max_age", photos }
  }

  if (nowMs - last >= quietMs) {
    return { action: "ask", reason: "settled", photos }
  }

  return { action: "wait", reason: "still_sending", photos }
}

/**
 * The plain-words purpose handed to the prose composer, so the question reads
 * like a person asking rather than a form.
 *
 * It names the count because "these 8 photos" and "this photo" are different
 * questions to answer, and offers the partner's open work as likely options —
 * a partner with one active run usually means that run, and saying so makes it
 * one tap of thought rather than an essay.
 */
export function buildPhotoQuestionPurpose(opts: {
  photos: number
  openRunLabels?: string[]
}): string {
  const count =
    opts.photos === 1 ? "a photo" : `${opts.photos} photos`

  const bits = [
    `they just sent ${count} and we do not know what they are for — thank them and ask what they would like done with them`,
  ]

  const open = (opts.openRunLabels ?? []).filter(Boolean)
  if (open.length) {
    bits.push(
      `their open work right now is: ${open.slice(0, 3).join(", ")} — you may offer these as likely options, but do not assume it is one of them`
    )
  }

  return bits.join("; ")
}
