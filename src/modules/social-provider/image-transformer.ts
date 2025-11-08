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
  format?: "auto" | "webp" | "avif" | "json"
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
 * Check if URL is from Cloudflare storage
 */
export function isCloudflareUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    // Check if it's your Cloudflare domain or R2 bucket
    // Adjust this based on your actual Cloudflare setup
    return (
      urlObj.hostname.includes("cloudflare") ||
      urlObj.hostname.includes("r2.dev") ||
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
