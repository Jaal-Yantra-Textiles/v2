/**
 * #2138 — the admin says what photos are for, in the same breath as asking.
 *
 * ## Why one action and not a field
 *
 * A context set separately from the request is a context nobody sets. The
 * natural moment to say "these will be fabric they're selling us" is while
 * typing "please send photos of the lot" — so the ask and the stamp are one
 * operation, and the stamp happens only if the ask actually sent.
 *
 * 🔑 That operation only became possible today. An admin cannot send free text
 * outside Meta's 24-hour window, and there was no approved template for
 * requesting photos — so out-of-window there was no way to ask at all. The
 * prose carrier (`jyt_partner_message_v1`, approved 2026-09-18) carries any
 * sentence under one approval, which is what makes the request sendable
 * whether or not the partner has messaged recently.
 */

/**
 * The purposes a photo can be given, and what each one means in plain words.
 *
 * Deliberately NOT a free-form string: this value is read by the product-create
 * flow's eligibility rule, so a typo would silently route photos nowhere. It is
 * also deliberately short — every entry here must have somewhere real for a
 * photo to land, or it is a label pretending to be a feature.
 */
export const PHOTO_CONTEXT_KINDS = {
  inventory_offer:
    "we are discussing buying stock or material from them, and these photos are of what they are offering us",
  product_submission:
    "we asked them for photos of something they want listed as a product on their storefront",
  run_progress:
    "we asked them to show progress on work they are currently making for us",
} as const

export type PhotoContextKind = keyof typeof PHOTO_CONTEXT_KINDS

/**
 * 🔴 `document` is absent on purpose.
 *
 * Proof of dispatch, invoices and bank slips have NOWHERE TYPED to land: there
 * is no inventory-order↔media link, only design↔folder, media↔textile-analysis
 * and person↔folder. Accepting the kind would file the document in a catchall
 * and report success, which is worse than refusing — the admin would believe
 * it had been captured against the order.
 */
export const UNSUPPORTED_KINDS: Record<string, string> = {
  document:
    "Documents have no typed destination yet — there is no inventory-order↔media link, so the file would land in a catchall folder while looking filed. Track it on #2138 before using this kind.",
}

/** Default life of a context, and the ceiling a refresh cannot exceed. */
export const PHOTO_CONTEXT_DEFAULT_TTL_HOURS = 72
export const PHOTO_CONTEXT_MAX_TTL_HOURS = 24 * 7

/**
 * PURE: when does this context stop speaking about now?
 *
 * Tied to the ask rather than the clock: a partner answers a photo request
 * within a day or two, and past that a photo is about something else. The
 * ceiling exists because the expiry is refreshed as photos arrive, and a
 * refresh loop must not be able to make a context permanent.
 */
export function resolveContextExpiry(
  now: Date = new Date(),
  ttlHours: number = PHOTO_CONTEXT_DEFAULT_TTL_HOURS,
  setAt?: Date
): string {
  const requested = Number.isFinite(ttlHours) && ttlHours > 0
    ? Math.min(ttlHours, PHOTO_CONTEXT_MAX_TTL_HOURS)
    : PHOTO_CONTEXT_DEFAULT_TTL_HOURS

  const candidate = now.getTime() + requested * 3_600_000
  // A refresh can extend the window, never past MAX from the ORIGINAL ask.
  const ceiling = setAt
    ? setAt.getTime() + PHOTO_CONTEXT_MAX_TTL_HOURS * 3_600_000
    : candidate

  return new Date(Math.min(candidate, ceiling)).toISOString()
}

/**
 * PURE: the plain-words purpose handed to the prose composer, so the request
 * reads like a person asking rather than a form.
 *
 * The admin's own note wins where present — they know why they are asking, and
 * a generic sentence about "stock or material" is worse than "the leftover
 * pashmina we discussed yesterday".
 */
export function buildPhotoRequestPurpose(
  kind: PhotoContextKind,
  note?: string | null
): string {
  const base = PHOTO_CONTEXT_KINDS[kind]
  const trimmed = (note ?? "").trim()
  const bits = [`ask them to send photos — ${base}`]
  if (trimmed) {
    bits.push(`what this is about, in our own words: ${trimmed}`)
  }
  bits.push(
    "keep it to one or two lines, and do not promise a price, a quantity or a date"
  )
  return bits.join("; ")
}
