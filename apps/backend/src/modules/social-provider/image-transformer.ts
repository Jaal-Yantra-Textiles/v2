/**
 * Image Transformer for Social Media Platforms
 * 
 * Uses Cloudflare Image Resizing to transform images to meet platform requirements
 * https://developers.cloudflare.com/images/image-resizing/url-format/
 */

export interface ImageTransformOptions {
  width?: number
  height?: number
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad"
  quality?: number
  format?: "auto" | "webp" | "avif" | "json" | "jpeg" | "png"
}

/**
 * Instagram aspect ratio presets
 */
export const INSTAGRAM_PRESETS = {
  square: { width: 1080, height: 1080, fit: "cover" as const },      // 1:1 - Most compatible
  portrait: { width: 1080, height: 1350, fit: "cover" as const },    // 4:5
  landscape: { width: 1080, height: 566, fit: "cover" as const },    // 1.91:1
} as const

/**
 * Check if URL is from Cloudflare storage or supports Cloudflare Image Resizing
 */
export function isCloudflareUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    // Check if it's your Cloudflare domain or R2 bucket
    return (
      urlObj.hostname.includes("cloudflare") ||
      urlObj.hostname.includes("r2.dev") ||
      urlObj.hostname.includes("jaalyantra.com") || // Your custom domain
      urlObj.pathname.includes("/cdn-cgi/imagedelivery/")
    )
  } catch {
    return false
  }
}

/**
 * Transform image URL using Cloudflare Image Resizing
 * 
 * @param imageUrl - Original image URL
 * @param options - Transformation options
 * @returns Transformed URL with Cloudflare parameters
 */
export function transformImageUrl(
  imageUrl: string,
  options: ImageTransformOptions
): string {
  try {
    const url = new URL(imageUrl)
    
    // Build transformation parameters
    const params: string[] = []
    
    if (options.width) params.push(`width=${options.width}`)
    if (options.height) params.push(`height=${options.height}`)
    if (options.fit) params.push(`fit=${options.fit}`)
    if (options.quality) params.push(`quality=${options.quality}`)
    if (options.format) params.push(`format=${options.format}`)
    
    const transformPath = `/cdn-cgi/image/${params.join(",")}`
    
    // Insert transformation path before the actual image path
    // Example: https://domain.com/image.jpg -> https://domain.com/cdn-cgi/image/width=1080/image.jpg
    const newPathname = transformPath + url.pathname
    url.pathname = newPathname
    
    return url.toString()
  } catch (error) {
    // If URL parsing fails, return original URL
    console.error("Failed to transform image URL:", error)
    return imageUrl
  }
}

/**
 * Transform image for Instagram with optimal settings
 * 
 * @param imageUrl - Original image URL
 * @param preset - Instagram aspect ratio preset (default: square)
 * @returns Transformed URL optimized for Instagram
 */
export function transformForInstagram(
  imageUrl: string,
  preset: keyof typeof INSTAGRAM_PRESETS = "square"
): string {
  // Only transform if it's a Cloudflare URL
  if (!isCloudflareUrl(imageUrl)) {
    console.warn("Image URL is not from Cloudflare storage, skipping transformation:", imageUrl)
    return imageUrl
  }
  
  const options = {
    ...INSTAGRAM_PRESETS[preset],
    quality: 85, // Good balance between quality and file size
    format: "auto" as const, // Let Cloudflare choose best format
  }
  
  return transformImageUrl(imageUrl, options)
}

/**
 * Meta's hard ceiling for an image sent over the WhatsApp Cloud API.
 * Exceed it and Meta rejects the ENTIRE message with error 131053 — not the
 * image, the message. The recipient sees nothing at all.
 */
export const WHATSAPP_MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Longest edge for an outbound WhatsApp image. WhatsApp itself downscales for
 * display, so anything larger is bytes spent to be thrown away — and bytes are
 * exactly what breaks the send.
 */
const WHATSAPP_MAX_EDGE = 1600

/**
 * Transform an image for the WhatsApp Cloud API (#1279).
 *
 * Between 2026-04 and 2026-08, 132 daily production-run reminders to partners
 * FAILED with `131053 · Media upload error — Image file has size 6533833 bytes
 * but must be atmost 5242880 bytes`. The reminder template carries the design
 * image, the design image is the full-size upload, and Meta drops the whole
 * message. Partners were never nagging-blind — they were never messaged. Runs
 * then hit the reminder cap and were parked, unasked.
 *
 * Two decisions worth keeping:
 *
 * - **`format: "jpeg"`, not `"auto"`.** Cloudflare's `auto` serves WebP/AVIF to
 *   clients that advertise them, and Meta's fetcher does not — an unsupported
 *   format is the same rejected message by another route. Designs are also
 *   uploaded as PNG, which is how a render reaches 6.5 MB in the first place;
 *   forcing JPEG is most of the saving. Measured on a real design asset:
 *   1,665,812 B PNG → 180,996 B JPEG.
 * - **`fit: "scale-down"`.** Never enlarge, never crop. A design photo cropped
 *   to a square is a worse message than a slightly large one.
 *
 * Non-Cloudflare URLs are returned untouched — there is nothing to rewrite, and
 * silently sending a different image would be worse than sending the original.
 * Callers must treat the result as best-effort, not as a guarantee of size.
 */
export function transformForWhatsApp(imageUrl: string): string {
  if (!imageUrl || !isCloudflareUrl(imageUrl)) {
    return imageUrl
  }

  // Already rewritten (a caller transformed it, or it is a resize URL from the
  // media library). Rewriting a rewrite yields a 404 path, so leave it alone.
  if (imageUrl.includes("/cdn-cgi/image/")) {
    return imageUrl
  }

  return transformImageUrl(imageUrl, {
    width: WHATSAPP_MAX_EDGE,
    fit: "scale-down",
    quality: 80,
    format: "jpeg",
  })
}

/**
 * Transform image for Facebook with optimal settings
 *
 * @param imageUrl - Original image URL
 * @returns Transformed URL optimized for Facebook
 */
export function transformForFacebook(imageUrl: string): string {
  if (!isCloudflareUrl(imageUrl)) {
    return imageUrl
  }
  
  // Facebook is more flexible, but optimize for common sizes
  return transformImageUrl(imageUrl, {
    width: 1200,
    height: 630, // 1.91:1 - Good for link previews
    fit: "cover",
    quality: 85,
    format: "auto",
  })
}
