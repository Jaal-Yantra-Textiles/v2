/**
 * Packlink rejects postcodes that every other system accepts.
 *
 * 🔑 This module exists because the failure is a **400 with no explanation**.
 * Packlink answers an unusable postcode with `{"messages":[{"message":"Bad
 * Request"}]}` — the same body it returns for a missing parameter, a malformed
 * package, or an unsupported lane. Nothing says "postcode". So a partner whose
 * quotes silently stopped working would have no way to tell this apart from
 * the carrier simply not serving the route.
 *
 * Both rules below were established EMPIRICALLY against the live API on
 * 2026-09-12, origin Greve in Chianti (IT 50022), 1 kg / 30×25×10 cm:
 *
 *   to[zip]=NW16XE   -> 400 Bad Request
 *   to[zip]=NW1 6XE  -> 200, 8 services (Poste Italiane €18.19 … Fedex €116.69)
 *
 *   to[zip]=00000    -> 400 Bad Request      (United Arab Emirates)
 *   to[zip]=1        -> 200, 6 services
 *   to[zip]=Dubai    -> 200, 6 services
 *
 * ⚠️ These are observations, not documentation. Packlink may accept more than
 * this; what is certain is that the two forms on the left DO fail and the forms
 * on the right DO work. Treat additions here as requiring the same evidence.
 */

/** UK postcodes are `OUTWARD INWARD`, the inward part always 3 characters. */
const GB_INWARD_LEN = 3

/**
 * Countries with no functioning postal-code system, where a placeholder must be
 * sent. `00000` is the conventional filler and is exactly what Packlink
 * REFUSES, so a non-zero token is used instead.
 *
 * Deliberately short: every entry here is one we have evidence for. A country
 * added on assumption would quietly change quotes for a lane nobody tested.
 */
const NO_POSTAL_SYSTEM: Record<string, string> = {
  AE: "1", // verified 2026-09-12: "00000" -> 400, "1" -> 200
}

/** Is the value absent, or a string of zeros/whitespace that means "none"? */
const isPlaceholder = (zip: string): boolean =>
  zip.length === 0 || /^0+$/.test(zip)

/**
 * Put a postcode into the form Packlink accepts for `country`.
 *
 * Returns the input unchanged when no rule applies — this normalises, it does
 * not validate. A postcode this function cannot improve is still sent, because
 * refusing to quote is worse than letting the carrier refuse with its own
 * reason.
 */
export const normalisePostcodeForPacklink = (
  countryCode: string | null | undefined,
  zip: string | null | undefined
): string => {
  const country = String(countryCode ?? "").trim().toUpperCase()
  const raw = String(zip ?? "").trim()

  const filler = NO_POSTAL_SYSTEM[country]
  if (filler && isPlaceholder(raw)) {
    return filler
  }

  if (country === "GB") {
    const compact = raw.replace(/\s+/g, "").toUpperCase()
    if (compact.length > GB_INWARD_LEN) {
      // Always rebuild the space rather than trusting the input's: "NW1  6XE"
      // and "nw16xe" both have to arrive as "NW1 6XE".
      const cut = compact.length - GB_INWARD_LEN
      return `${compact.slice(0, cut)} ${compact.slice(cut)}`
    }
    return compact
  }

  return raw
}
