import { listRegions } from "@lib/data/regions"
import { listProducts } from "@lib/data/products"

// Default country used when regions can't be loaded (build-time safety net).
const FALLBACK_COUNTRY = "in"

// Explicit overrides where the ISO-2 country doesn't map cleanly to BCP-47
// via `en-${cc}`. All current regions are English-speaking, so we hard-code
// the language to "en". If the storefront ever ships non-English locales,
// this mapping should move to the region record itself.
const LOCALE_OVERRIDES: Record<string, string> = {
  uk: "en-GB",
}

/**
 * Clean a description for use in <meta name="description">:
 *   - Strips HTML tags (descriptions in Medusa often contain <p>, <strong>, ...)
 *   - Decodes common HTML entities (&#x27; &amp; &quot; &lt; &gt; &nbsp;) so
 *     the meta tag doesn't render "men&#x27;s" in social previews.
 *   - Collapses whitespace.
 *   - Truncates to `maxLength` (default 160 — Google's typical limit) without
 *     cutting mid-word where possible.
 */
export const cleanMetaDescription = (
  raw: string | null | undefined,
  maxLength = 160
): string => {
  if (!raw) return ""

  const stripped = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (stripped.length <= maxLength) return stripped

  // Prefer truncating at the last space before the limit to avoid
  // cutting a word in half. Trim 3 extra chars to fit the ellipsis.
  const cut = stripped.slice(0, maxLength - 1)
  const lastSpace = cut.lastIndexOf(" ")
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base}…`
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

/**
 * Fetch the thumbnail of the first product in a category or collection.
 * Used to generate Open Graph / Twitter preview images for listing pages
 * that don't have their own banner image.
 *
 * Returns `null` on any error — OG image is a nice-to-have and should
 * never break the metadata response.
 */
export const getFirstProductImageFor = async (filter: {
  countryCode: string
  categoryId?: string
  collectionId?: string
}): Promise<string | null> => {
  const { countryCode, categoryId, collectionId } = filter

  try {
    const { response } = await listProducts({
      countryCode,
      queryParams: {
        limit: 1,
        fields: "thumbnail",
        ...(categoryId ? { category_id: [categoryId] } : {}),
        ...(collectionId ? { collection_id: [collectionId] } : {}),
      } as any,
    })
    return response.products[0]?.thumbnail ?? null
  } catch {
    return null
  }
}

