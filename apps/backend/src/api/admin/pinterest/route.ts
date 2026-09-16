import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { searchPinterestWorkflow } from "../../../workflows/socials/search-pinterest"

/**
 * GET /admin/pinterest?q=<search>&bookmark=<cursor>
 *
 * Proxies Pinterest pin search via the search-pinterest workflow, which
 * resolves the connected platform's access token (Settings → External
 * platforms) and searches Pinterest's pin API.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = (req.query.q as string) || ""
  const bookmark = (req.query.bookmark as string) || ""

  if (!query.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Search query (q) is required")
  }

  const { result, errors } = await searchPinterestWorkflow(req.scope).run({
    input: { query, bookmark },
  })

  if (errors && errors.length > 0) {
    throw errors[0]
  }

  // Normalize to a clean response
  const results = result.pins.map((pin: any) => ({
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
    bookmark: result.bookmark,
    query,
  })
}
