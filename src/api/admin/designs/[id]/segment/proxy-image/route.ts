import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * GET /admin/designs/:id/segment/proxy-image?url=<remote-url>
 *
 * Proxies a remote image through the backend to avoid CORS issues
 * when the browser needs to load fal.ai CDN images as data URLs.
 *
 * Only allows URLs from known safe origins (fal.ai).
 */
const ALLOWED_HOSTS = [
  "fal.media",
  "storage.googleapis.com",
  "fal-cdn.batuhan.co",
  "v3-fal.fal.media",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const url = req.query.url as string

  if (!url) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "url query parameter is required"
    )
  }

  // Validate the URL is from an allowed host
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid URL"
    )
  }

  const isAllowed = ALLOWED_HOSTS.some(
    (host) =>
      parsedUrl.hostname === host ||
      parsedUrl.hostname.endsWith(`.${host}`)
  )

  if (!isAllowed) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Host ${parsedUrl.hostname} is not in the allowed list`
    )
  }

  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Remote server returned ${response.status}`
      )
    }

    const contentType =
      response.headers.get("content-type") || "image/png"
    const buffer = Buffer.from(await response.arrayBuffer())

    res.setHeader("Content-Type", contentType)
    res.setHeader("Cache-Control", "public, max-age=3600")
    res.status(200).end(buffer)
  } catch (err: any) {
    if (err instanceof MedusaError) throw err
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to fetch image: ${err.message}`
    )
  }
}
