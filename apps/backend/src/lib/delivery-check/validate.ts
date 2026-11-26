/**
 * Postal-code checks for the storefront delivery check (`GET /store/delivery-check`).
 *
 * India is strict because two carriers will be asked about the pin and both
 * need exactly six digits (the first never 0). Everywhere else is LOOSE on
 * purpose: the point is to catch a typo or a pasted phone number before it
 * costs a carrier call, not to be the authority on another country's postcodes.
 * A country we have no pattern for accepts any 2-10 letters/digits/spaces/dashes.
 *
 * Pure — unit-tested.
 */

/** Countries whose postal format we know well enough to check. Upper-cased, spaces kept. */
const PATTERNS: Record<string, RegExp> = {
  IN: /^[1-9][0-9]{5}$/,
  US: /^[0-9]{5}(-[0-9]{4})?$/,
  CA: /^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$/,
  GB: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/,
  AU: /^[0-9]{4}$/,
  NZ: /^[0-9]{4}$/,
  DE: /^[0-9]{5}$/,
  FR: /^[0-9]{5}$/,
  IT: /^[0-9]{5}$/,
  ES: /^[0-9]{5}$/,
  NL: /^[0-9]{4} ?[A-Z]{2}$/,
  SE: /^[0-9]{3} ?[0-9]{2}$/,
  JP: /^[0-9]{3}-?[0-9]{4}$/,
  SG: /^[0-9]{6}$/,
}

/**
 * Countries with no postal codes at all (or none in common use). A buyer there
 * must not be blocked for leaving the field empty.
 */
const NO_POSTAL = new Set(["AE", "HK", "QA", "IE", "SA"])

const LOOSE = /^[A-Z0-9][A-Z0-9 -]{0,8}[A-Z0-9]$/

export type PostalCheck =
  | { ok: true; country_code: string; postal_code: string }
  | { ok: false; message: string }

export function normalizePostalCode(
  countryCode: string | undefined | null,
  postalCode: string | undefined | null
): PostalCheck {
  const country = String(countryCode || "").trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    return { ok: false, message: "Choose a country." }
  }

  const raw = String(postalCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")

  if (country === "IN") {
    // People type "110 001" and "110-001"; the carriers want 110001.
    const pin = raw.replace(/[\s-]/g, "")
    if (!PATTERNS.IN.test(pin)) {
      return { ok: false, message: "Enter a 6-digit PIN code." }
    }
    return { ok: true, country_code: "in", postal_code: pin }
  }

  if (!raw) {
    if (NO_POSTAL.has(country)) {
      return { ok: true, country_code: country.toLowerCase(), postal_code: "" }
    }
    return { ok: false, message: "Enter a postal code." }
  }

  const pattern = PATTERNS[country] ?? LOOSE
  if (!pattern.test(raw)) {
    return { ok: false, message: "That postal code doesn't look right." }
  }
  return { ok: true, country_code: country.toLowerCase(), postal_code: raw }
}
