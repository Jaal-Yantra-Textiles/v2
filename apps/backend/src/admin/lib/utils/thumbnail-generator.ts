/**
 * Thumbnail Generator Utility
 * 
 * Generates small thumbnail previews from image files to reduce memory consumption.
 * Instead of loading full-resolution images (which can be 10MB+), this creates
 * small ~200px thumbnails that use minimal memory.
 */

const THUMBNAIL_MAX_SIZE = 200 // Max width/height in pixels
const THUMBNAIL_QUALITY = 0.7 // JPEG quality (0-1)

export interface ThumbnailResult {
  dataUrl: string
  width: number
  height: number
}

/**
 * Generate a thumbnail from an image file.
 * Uses Canvas API to resize the image to a small preview.
 * 
 * @param file - The image file to generate a thumbnail from
 * @param maxSize - Maximum width/height of the thumbnail (default: 200)
 * @returns Promise resolving to thumbnail data URL, or null if generation fails
 */
export async function generateThumbnail(
  file: File,
  maxSize: number = THUMBNAIL_MAX_SIZE
): Promise<ThumbnailResult | null> {
  // Only process image files
  if (!file.type.startsWith("image/")) {
    return null
  }

  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      // Clean up the object URL immediately after loading
      URL.revokeObjectURL(objectUrl)

      try {
        // Calculate thumbnail dimensions maintaining aspect ratio
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }

        // Create canvas and draw resized image
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(null)
          return
        }

        // Use better image smoothing for quality
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "medium"

        ctx.drawImage(img, 0, 0, width, height)

        // Convert to data URL (JPEG for smaller size, PNG for transparency)
        const format = file.type === "image/png" ? "image/png" : "image/jpeg"
        const quality = format === "image/jpeg" ? THUMBNAIL_QUALITY : undefined
        const dataUrl = canvas.toDataURL(format, quality)

        resolve({ dataUrl, width, height })
      } catch (error) {
        console.error("Thumbnail generation error:", error)
        resolve(null)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }

    img.src = objectUrl
  })
}

/**
 * Generate thumbnails for multiple files in parallel with concurrency limit.
 * Prevents overwhelming the browser with too many simultaneous operations.
 * 
 * @param files - Array of files to generate thumbnails for
 * @param concurrency - Maximum number of concurrent thumbnail generations (default: 3)
 * @returns Map of file name+size key to thumbnail result
 */
export async function generateThumbnailsBatch(
  files: File[],
  concurrency: number = 3
): Promise<Map<string, ThumbnailResult | null>> {
  const results = new Map<string, ThumbnailResult | null>()
  const queue = [...files]

  const processNext = async (): Promise<void> => {
    while (queue.length > 0) {
      const file = queue.shift()
      if (!file) break

      const key = `${file.name}|${file.size}`
      const thumbnail = await generateThumbnail(file)
      results.set(key, thumbnail)
    }
  }

  // Start concurrent workers
  const workers = Array(Math.min(concurrency, files.length))
    .fill(null)
    .map(() => processNext())

  await Promise.all(workers)
  return results
}

/**
 * Get a thumbnail URL from a Cloudflare image URL.
 * Uses Cloudflare Image Resizing to get a small version.
 * 
 * @param imageUrl - Original image URL
 * @param size - Thumbnail size (default: 100)
 * @returns Transformed URL for thumbnail, or original if not Cloudflare
 */
export function getCloudflareThumbUrl(imageUrl: string | undefined | null, size: number = 100): string | undefined {
  if (!imageUrl) return undefined
  
  try {
    const url = new URL(imageUrl)
    
    // Check if it's a Cloudflare-compatible URL
    const isCloudflare = (
      url.hostname.includes("cloudflare") ||
      url.hostname.includes("r2.dev") ||
      url.hostname.includes("jaalyantra.com") ||
      url.pathname.includes("/cdn-cgi/imagedelivery/")
    )
    
    if (!isCloudflare) {
      return imageUrl
    }
    
    // Already has transformation? Return as-is
    if (url.pathname.includes("/cdn-cgi/image/")) {
      return imageUrl
    }
    
    // Add Cloudflare image transformation
    const transformPath = `/cdn-cgi/image/width=${size},height=${size},fit=cover,quality=70,format=auto`
    url.pathname = transformPath + url.pathname
    
    return url.toString()
  } catch {
    return imageUrl
  }
}

/**
 * Get a file icon placeholder for non-image files.
 * Returns an SVG data URL representing the file type.
 */
export function getFileIconPlaceholder(file: File): string {
  const extension = file.name.split(".").pop()?.toUpperCase() || "FILE"
  
  // Simple SVG placeholder with file extension
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#f3f4f6" rx="8"/>
      <rect x="20" y="15" width="60" height="70" fill="#e5e7eb" rx="4"/>
      <polygon points="60,15 80,35 60,35" fill="#d1d5db"/>
      <text x="50" y="65" text-anchor="middle" font-family="system-ui" font-size="12" font-weight="600" fill="#6b7280">
        ${extension.slice(0, 4)}
      </text>
    </svg>
  `
  
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}
