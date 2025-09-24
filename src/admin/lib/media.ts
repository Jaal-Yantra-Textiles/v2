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

export function isImageUrl(url?: string) {
  if (!url) return false
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /(\.avif|\.webp|\.jpg|\.jpeg|\.png|\.gif)$/i.test(path)
  } catch {
    return /(\.avif|\.webp|\.jpg|\.jpeg|\.png|\.gif)$/i.test(url.toLowerCase())
  }
}
