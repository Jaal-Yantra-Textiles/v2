// next/image loader that routes Cloudflare-hosted images through
// Cloudflare Image Transformations (cdn-cgi/image) so the source the
// browser fetches is already resized below Vercel's 4MB cap.
//
// Requires Cloudflare Image Transformations to be enabled on the
// `automatic.jaalyantra.com` zone (Cloudflare dashboard → Speed →
// Optimization → Image Optimization → "Resize images on this zone").
//
// For non-Cloudflare URLs we fall back to Vercel's built-in optimizer by
// returning the `/_next/image` URL — same shape `<Image>` would have
// constructed itself, so non-CF hosts keep their existing optimization.

const CF_RESIZE_HOSTS = new Set(["automatic.jaalyantra.com"])

type LoaderArgs = { src: string; width: number; quality?: number }

export default function imageLoader({ src, width, quality }: LoaderArgs): string {
  const q = quality ?? 85

  // Relative paths (e.g. /favicon.ico) — let the browser fetch them as-is.
  if (!src.startsWith("http")) {
    return src
  }

  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return src
  }

  if (CF_RESIZE_HOSTS.has(parsed.hostname)) {
    // Cloudflare Image Transformations URL format:
    //   https://<host>/cdn-cgi/image/<options>/<source-path>
    // `format=auto` lets CF serve AVIF/WebP based on Accept header.
    const opts = `width=${width},quality=${q},format=auto`
    return `${parsed.origin}/cdn-cgi/image/${opts}${parsed.pathname}${parsed.search}`
  }

  // Default path: route through Vercel's image optimizer the way <Image>
  // would have done without a custom loader.
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${q}`
}
