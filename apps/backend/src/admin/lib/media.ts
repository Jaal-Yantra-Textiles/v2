export function getThumbUrl(url?: string, opts?: { width?: number; quality?: number; fit?: "cover" | "contain" | "scale-down" }) {
  if (!url) return ""
  try {
    const u = new URL(url)
    const width = opts?.width ?? 256
    const quality = opts?.quality ?? 70
    const fit = opts?.fit ?? "cover"
    // Cloudflare Image Resizing via cdn-cgi. If not enabled, the URL will 404, so fall back to original.
    // Example: https://domain.com/cdn-cgi/image/width=256,quality=70,fit=cover/path/to/file.jpg
    return `${u.origin}/cdn-cgi/image/width=${width},quality=${quality},fit=${fit}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return url.toLowerCase().split("?")[0]
  }
}

/**
 * Photos a browser cannot draw itself. iPhone uploads are HEIC (269 of the
 * folder photos on prod, #2587); Chrome and Firefox show nothing for them.
 * Cloudflare's resizer reads HEIC and serves JPEG, so these must always go
 * through it.
 */
const BROWSER_UNRENDERABLE = /\.(heic|heif)$/i

export function isImageUrl(url?: string) {
  if (!url) return false
  return /\.(avif|webp|jpg|jpeg|png|gif|heic|heif)$/i.test(pathOf(url))
}

/**
 * The URL to put in a full-size <img>. The original for formats a browser can
 * draw; a large converted JPEG for HEIC/HEIF, which it cannot.
 */
export function displayUrl(url?: string) {
  if (!url) return ""
  return BROWSER_UNRENDERABLE.test(pathOf(url))
    ? getThumbUrl(url, { width: 1600, quality: 85, fit: "scale-down" })
    : url
}
