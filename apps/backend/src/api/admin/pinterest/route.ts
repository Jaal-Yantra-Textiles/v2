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

  // Try partner search first (broader results), fall back to user pins
  let pins: any[] = []
  let nextBookmark: string | null = null

  try {
    const result = await searchPartnerPins(accessToken, query, bookmark)
    pins = result.pins
    nextBookmark = result.bookmark
  } catch {
    // Partner search not available — fall back to user's own pins
    try {
      const result = await searchUserPins(accessToken, query, bookmark)
      pins = result.pins
      nextBookmark = result.bookmark
    } catch (e: any) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Pinterest API error: ${e.message}`
      )
    }
  }

  // Normalize to a clean response
  const results = pins.map((pin: any) => ({
    id: pin.id,
    title: pin.title || "",
    description: pin.description || "",
    alt_text: pin.alt_text || "",
    dominant_color: pin.dominant_color || null,
    images: {
      small: pin.media?.images?.["150x150"]?.url || null,
      medium: pin.media?.images?.["400x300"]?.url || null,
      large: pin.media?.images?.["600x"]?.url || null,
      original: pin.media?.images?.["1200x"]?.url || pin.media?.images?.["600x"]?.url || null,
    },
    link: pin.link || null,
    source: "pinterest",
  }))

  res.json({
    pins: results,
    bookmark: nextBookmark,
    query,
  })
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
