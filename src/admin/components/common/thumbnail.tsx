import { Photo } from "@medusajs/icons"
import { clx } from "@medusajs/ui"
import { getCloudflareThumbUrl } from "../../lib/utils/thumbnail-generator"

type ThumbnailProps = {
  src?: string | null
  alt?: string
  size?: "small" | "base" | "large"
}

// Size mapping for Cloudflare image resizing
const sizeToPixels = {
  small: 40,
  base: 64,
  large: 100,
}

export const Thumbnail = ({ src, alt, size = "base" }: ThumbnailProps) => {
  // Get optimized thumbnail URL for Cloudflare images
  const thumbnailSrc = src ? getCloudflareThumbUrl(src, sizeToPixels[size]) : undefined
  
  return (
    <div
      className={clx(
        "bg-ui-bg-component border-ui-border-base flex items-center justify-center overflow-hidden rounded border",
        {
          "h-8 w-6": size === "base",
          "h-5 w-4": size === "small",
          "h-12 w-12": size === "large",
        }
      )}
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt={alt}
          className="h-full w-full object-cover object-center"
          loading="lazy"
        />
      ) : (
        <Photo className="text-ui-fg-subtle" />
      )}
    </div>
  )
}