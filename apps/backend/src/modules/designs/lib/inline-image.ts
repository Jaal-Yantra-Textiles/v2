import { MedusaError } from "@medusajs/framework/utils"

import {
  MAX_INLINE_IMAGE_BYTES,
  allowedImageOrigins,
  checkImageSrc,
  isInlinableImageType,
} from "./moodboard-image-src"

/**
 * Fetch one image and return it as a real `data:` URI (#2228).
 *
 * ## Why this exists at all
 *
 * `build-moodboard-scene.ts` registers image files as
 * `files[id].dataURL = "https://…"` — a URL in the field Excalidraw expects to
 * hold a `data:` URI. Two different failures follow from that one line:
 *
 *   - **partner-ui**: the image does not render. Excalidraw draws its
 *     broken-image placeholder, so a generated board shows grey boxes where the
 *     flats should be.
 *   - **admin**: it DOES render, and drawing a cross-origin image taints the
 *     canvas, so `toBlob` is refused and the export dies with
 *     "The operation is insecure."
 *
 * A `data:` URI never taints a canvas and needs no CORS, which fixes both.
 *
 * ## Why the server has to do the fetching
 *
 * The obvious client-side fix — fetch the URL and convert — is blocked: the CDN
 * sends no `Access-Control-Allow-Origin`. Verified:
 *
 *     curl -sD - -o /dev/null -H "Origin: http://localhost:5173" <cdn>/x.png
 *     HTTP/1.1 200 OK        ← and no access-control-allow-origin
 *
 * Our own API does send CORS to the partner app, so the bytes come back through
 * here instead.
 *
 * ⚠️ Shared by the partner and admin routes deliberately. The SSRF gate, the
 * size cap and the content-type check are the parts that must not drift, and
 * two copies of a security decision is how one of them gets fixed and the other
 * does not.
 */
export const inlineImageAsDataUrl = async (src: unknown): Promise<string> => {
  const verdict = checkImageSrc(src, allowedImageOrigins(process.env))
  if (!verdict.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, verdict.reason)
  }

  let upstream: Response
  try {
    upstream = await fetch(verdict.url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e: any) {
    /**
     * `redirect: "error"` on purpose: a 302 is how an allowed host walks the
     * fetch off the allow-list, and following it would check the origin we were
     * given rather than the one we end up at.
     */
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Could not fetch the image: ${e?.message ?? "request failed"}`
    )
  }

  if (!upstream.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The image host answered ${upstream.status}.`
    )
  }

  const contentType = upstream.headers.get("content-type")
  if (!isInlinableImageType(contentType)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `That URL is not an image (${contentType ?? "no content-type"}).`
    )
  }

  const buf = Buffer.from(await upstream.arrayBuffer())
  if (buf.byteLength > MAX_INLINE_IMAGE_BYTES) {
    /**
     * Checked on the BODY, not on `content-length`, which a host may omit or
     * lie about. Inlining is base64 in a JSON response and then in a jsonb
     * column, so an unbounded image is a memory and storage problem at both
     * ends.
     */
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `That image is larger than the ${Math.round(
        MAX_INLINE_IMAGE_BYTES / 1024 / 1024
      )}MB inline limit.`
    )
  }

  const mime = (contentType ?? "image/png").split(";")[0].trim()
  return `data:${mime};base64,${buf.toString("base64")}`
}
