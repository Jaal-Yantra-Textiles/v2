/**
 * Which image URLs the moodboard proxy will fetch (#2228).
 *
 * PURE, and separate from the route, because this is the SSRF decision and it
 * is the only part of the proxy that must never be got wrong. A route that
 * takes a `src` from the caller and fetches it is a server-side request
 * forgery primitive unless something says no — this is that something.
 *
 * 🔴 An ALLOW-LIST of origins, not a deny-list of private ranges. Blocking
 * `127.0.0.1`, `169.254.169.254` and the RFC1918 ranges is a game you lose to
 * DNS: a name on a permitted host can resolve to a private address, and the
 * check happens before the socket. Naming the two origins that legitimately
 * hold our images cannot be talked around.
 *
 * The origins come from configuration, never from the request:
 *   - `S3_FILE_URL` — the CDN in front of the bucket (R2, today
 *     `https://automatic.jaalyantra.com`), which is where design media lives.
 *   - `MEDUSA_BACKEND_URL` — our own `/static/…`, used by local uploads.
 */

/** Origins the proxy may fetch from, derived from config. Empty ⇒ fetch nothing. */
export const allowedImageOrigins = (
  env: Record<string, string | undefined>
): string[] => {
  const origins: string[] = []
  for (const key of ["S3_FILE_URL", "MEDUSA_BACKEND_URL"]) {
    const raw = (env[key] ?? "").trim()
    if (!raw) {
      continue
    }
    try {
      origins.push(new URL(raw).origin)
    } catch {
      // A malformed config value contributes nothing; it must never widen the
      // list, and it must not throw on a path that gates a fetch.
    }
  }
  return [...new Set(origins)]
}

export type ImageSrcVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string }

/**
 * May the proxy fetch this `src`?
 *
 * Rejections carry a reason because the caller turns them into a 400 the
 * operator has to act on — "not an allowed image host" is a different fix from
 * "not a URL".
 */
export const checkImageSrc = (
  src: unknown,
  allowedOrigins: string[]
): ImageSrcVerdict => {
  if (typeof src !== "string" || !src.trim()) {
    return { ok: false, reason: "Missing 'src'." }
  }

  let parsed: URL
  try {
    parsed = new URL(src.trim())
  } catch {
    return { ok: false, reason: "'src' is not a valid absolute URL." }
  }

  /**
   * `data:` is already inline and needs no proxy; `file:`, `gopher:` and the
   * rest are how an SSRF reads a disk or a metadata service. Only the two
   * schemes an image can legitimately arrive over.
   */
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `Unsupported scheme '${parsed.protocol}'.` }
  }

  /**
   * ⚠️ Compared on ORIGIN — scheme + host + port together. Comparing the
   * hostname alone would accept `http://` against an `https://` allow-list
   * entry, and comparing with `startsWith` would accept
   * `https://automatic.jaalyantra.com.evil.test`.
   */
  if (!allowedOrigins.includes(parsed.origin)) {
    return { ok: false, reason: "'src' is not on an allowed image host." }
  }

  return { ok: true, url: parsed.toString() }
}

/** Refuse to inline something that is not an image, or is absurdly large. */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

export const isInlinableImageType = (contentType: string | null): boolean =>
  !!contentType && /^image\//i.test(contentType.split(";")[0].trim())
