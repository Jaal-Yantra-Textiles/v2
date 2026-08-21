import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * GET /admin/pinterest?q=<search>&bookmark=<cursor>
 *
 * Proxies Pinterest pin search API. Uses the authenticated user's pins
 * via /v5/search/pins, or partner search via /v5/search/partner/pins
 * if available.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const accessToken = process.env.PINTEREST_ACCESS_TOKEN
  if (!accessToken) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Pinterest integration not configured. Set PINTEREST_ACCESS_TOKEN."
    )
  }

  const query = (req.query.q as string) || ""
  const bookmark = (req.query.bookmark as string) || ""

  if (!query.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Search query (q) is required")
  }

  // Three tiers, widest first. Both search tiers are gated behind things a token
  // alone cannot grant, so the third exists to keep this endpoint useful rather
  // than returning an error for the common setup:
  //
  //   1. partner search — all of Pinterest. Needs the RESTRICTED `pin_search`
  //      feature, which Pinterest grants per-app on request. Scopes don't help.
  //   2. user pin search — the account's own pins, server-side query. Needs the
  //      `boards:read_secret` + `pins:read_secret` scopes on the token, so a
  //      token authorized without them fails here even though it works elsewhere.
  //   3. own pins, filtered locally — needs only `pins:read`, which every token
  //      has. For "design from a reference" this is often the BETTER source
  //      anyway: the team's own saved board is curated, global search is not.
  let pins: any[] = []
  let nextBookmark: string | null = null
  let source: "partner_search" | "user_search" | "own_pins" = "partner_search"
  const unavailable: string[] = []

  try {
    const result = await searchPartnerPins(accessToken, query, bookmark)
    pins = result.pins
    nextBookmark = result.bookmark
  } catch (e: any) {
    unavailable.push(`partner search (${e.message})`)
    try {
      const result = await searchUserPins(accessToken, query, bookmark)
      pins = result.pins
      nextBookmark = result.bookmark
      source = "user_search"
    } catch (e2: any) {
      unavailable.push(`pin search (${e2.message})`)
      try {
        const result = await listOwnPins(accessToken, query, bookmark)
        pins = result.pins
        nextBookmark = result.bookmark
        source = "own_pins"
      } catch (e3: any) {
        // Every tier failed — this is a real outage or a dead token, so say
        // which rungs were tried instead of one opaque message.
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Pinterest API error: ${e3.message}. Also unavailable: ${unavailable.join("; ")}`
        )
      }
    }
  }

  // Normalize to a clean response
  const results = pins.map((pin: any) => {
    // Carousel pins (media_type "multiple_images") carry NO `media.images` —
    // their sizes live on each entry of `media.items`. Reading only
    // `media.images` returns null urls for every carousel, which on this account
    // is 25 of 49 pins: over half the references, silently imageless. Fall back
    // to the first slide, which is the one that represents the pin.
    const images = pin.media?.images ?? pin.media?.items?.[0]?.images ?? {}
    return {
      id: pin.id,
      title: pin.title || "",
      description: pin.description || "",
      alt_text: pin.alt_text || "",
      dominant_color: pin.dominant_color || null,
      images: {
        small: images?.["150x150"]?.url || null,
        medium: images?.["400x300"]?.url || null,
        large: images?.["600x"]?.url || null,
        original: images?.["1200x"]?.url || images?.["600x"]?.url || null,
      },
      // How many slides, so the assistant can say "this is a 4-image carousel"
      // rather than pretending a single frame is the whole reference.
      image_count: pin.media?.items?.length ?? (pin.media?.images ? 1 : 0),
      link: pin.link || null,
      source: "pinterest",
    }
  })

  res.json({
    pins: results,
    bookmark: nextBookmark,
    query,
    // Which tier answered. The assistant surfaces this so an operator is never
    // told "no results on Pinterest" when we actually only looked at our own 49
    // saved pins.
    source,
    ...(unavailable.length ? { unavailable } : {}),
  })
}

/**
 * Tier 3: the account's own pins, filtered client-side on title/description/
 * alt_text. Needs only `pins:read`.
 *
 * Pinterest has no query parameter on GET /v5/pins, so the filtering happens
 * here. That is fine at this scale (the account holds tens of pins, not
 * thousands) and an empty query just returns the most recent pins — which is
 * what "show me our references" should do.
 */
async function listOwnPins(
  token: string,
  query: string,
  bookmark?: string
): Promise<{ pins: any[]; bookmark: string | null }> {
  const params = new URLSearchParams({ page_size: "50" })
  if (bookmark) params.set("bookmark", bookmark)

  const response = await fetch(`https://api.pinterest.com/v5/pins?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Listing own pins failed: ${response.status}`)
  }

  const data = await response.json()
  const items: any[] = data.items || []

  const needle = query.trim().toLowerCase()
  const terms = needle ? needle.split(/\s+/) : []
  const matches = terms.length
    ? items.filter((pin) => {
        const haystack = [pin.title, pin.description, pin.alt_text]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        // Every term must appear — an OR match on "indigo block print" returns
        // every pin mentioning "print", which is not a search.
        return terms.every((t) => haystack.includes(t))
      })
    : items

  return { pins: matches, bookmark: data.bookmark || null }
}

async function searchPartnerPins(
  token: string,
  query: string,
  bookmark?: string
): Promise<{ pins: any[]; bookmark: string | null }> {
  const params = new URLSearchParams({
    term: query,
    country_code: "US",
    limit: "20",
  })
  if (bookmark) params.set("bookmark", bookmark)

  const response = await fetch(
    `https://api.pinterest.com/v5/search/partner/pins?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!response.ok) {
    throw new Error(`Partner search failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    pins: data.items || [],
    bookmark: data.bookmark || null,
  }
}

async function searchUserPins(
  token: string,
  query: string,
  bookmark?: string
): Promise<{ pins: any[]; bookmark: string | null }> {
  const params = new URLSearchParams({ query })
  if (bookmark) params.set("bookmark", bookmark)

  const response = await fetch(
    `https://api.pinterest.com/v5/search/pins?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!response.ok) {
    throw new Error(`User pin search failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    pins: data.items || [],
    bookmark: data.bookmark || null,
  }
}
