import { listRegions } from "@lib/data/regions"

// Default country used when regions can't be loaded (build-time safety net).
const FALLBACK_COUNTRY = "in"

// Explicit overrides where the ISO-2 country doesn't map cleanly to BCP-47
// via `en-${cc}`. All current regions are English-speaking, so we hard-code
// the language to "en". If the storefront ever ships non-English locales,
// this mapping should move to the region record itself.
const LOCALE_OVERRIDES: Record<string, string> = {
  uk: "en-GB",
}

export const countryToLocale = (cc: string): string => {
  const lower = cc.toLowerCase()
  return LOCALE_OVERRIDES[lower] ?? `en-${lower.toUpperCase()}`
}

let cachedCountryCodes: string[] | null = null

export const getAllCountryCodes = async (): Promise<string[]> => {
  if (cachedCountryCodes) return cachedCountryCodes

  try {
    const regions = await listRegions()
    const codes = (regions ?? [])
      .flatMap((r) => r.countries?.map((c) => c.iso_2) ?? [])
      .filter((c): c is string => Boolean(c))

    cachedCountryCodes = codes.length ? codes : [FALLBACK_COUNTRY]
  } catch {
    cachedCountryCodes = [FALLBACK_COUNTRY]
  }

  return cachedCountryCodes
}

/**
 * Build canonical + hreflang alternates for a localized path.
 *
 * @param currentCountryCode — the country code of the page being rendered
 * @param pathWithoutCountry — the path segment *after* the country code,
 *   e.g. "products/hand-loom-dress" (no leading slash, no country prefix)
 */
export const buildLocalizedAlternates = async (
  currentCountryCode: string,
  pathWithoutCountry: string
): Promise<{
  canonical: string
  languages: Record<string, string>
}> => {
  const countryCodes = await getAllCountryCodes()
  const cleanPath = pathWithoutCountry.replace(/^\/+/, "")

  const languages: Record<string, string> = {}
  for (const cc of countryCodes) {
    const url = `/${cc}${cleanPath ? `/${cleanPath}` : ""}`
    languages[countryToLocale(cc)] = url
  }

  // x-default points at the current country's URL — Google treats this as
  // the fallback when no locale matches. Using the current region keeps
  // canonical and x-default aligned for the page being rendered.
  const canonicalPath = `/${currentCountryCode}${cleanPath ? `/${cleanPath}` : ""}`
  languages["x-default"] = canonicalPath

  return {
    canonical: canonicalPath,
    languages,
  }
}
