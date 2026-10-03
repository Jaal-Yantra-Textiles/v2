import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js"

/**
 * Normalise a human-typed phone number to E.164 ("+919876543210").
 *
 * This is the identity key for phone login: the `phone-pin` provider
 * identity's `entity_id` is this form, and a login matches it byte for byte —
 * so both every write of `partner_admin.phone` and every login go through here.
 *
 * Deliberately NOT a validity check — libphonenumber's `isValid()` rejects
 * test and some newly issued ranges, and refusing a partner's real number is
 * worse than accepting an odd one. A number without a leading "+" is read as
 * `defaultCountry` (India).
 *
 * Returns null when nothing number-shaped is left.
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "IN"
): string | null {
  if (raw === null || raw === undefined) {
    return null
  }
  const trimmed = String(raw).trim()
  if (!trimmed) {
    return null
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
  if (parsed?.number) {
    return parsed.number
  }

  // libphonenumber refuses some fictional numbers outright; keep anything that
  // is already international and plausibly long, stripped of separators.
  const compact = trimmed.replace(/[\s().-]/g, "")
  if (/^\+\d{6,15}$/.test(compact)) {
    return compact
  }
  return null
}
