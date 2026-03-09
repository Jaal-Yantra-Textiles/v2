import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/images/proxy?url=<encoded-url>
 *
 * Server-side image proxy used by the hang tag PDF generator.
 * Fetches the target image server-side (no browser CORS restrictions) and
 * streams it back so the browser can embed it in a pdf-lib document without
 * needing cross-origin headers on the source host.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const raw = req.query.url as string | undefined
  if (!raw) {
    return res.status(400).json({ error: "Missing url param" })
  }

  let url: string
  try {
    url = decodeURIComponent(raw)
    new URL(url) // validate
  } catch {
    return res.status(400).json({ error: "Invalid url param" })
  }

  try {
    const upstream = await fetch(url)
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` })
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
    const buf = await upstream.arrayBuffer()

    res.setHeader("Content-Type", contentType)
    res.setHeader("Cache-Control", "public, max-age=3600")
    res.status(200).end(Buffer.from(buf))
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to fetch image" })
  }
}
