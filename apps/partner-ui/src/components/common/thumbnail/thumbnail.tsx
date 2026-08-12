import { Photo } from "@medusajs/icons"
import { clx } from "@medusajs/ui"

type ThumbnailProps = {
  src?: string | null
  alt?: string
  size?: "small" | "base"
}

export const Thumbnail = ({ src, alt, size = "base" }: ThumbnailProps) => {
  return (
    <div
      className={clx(
        "bg-ui-bg-component border-ui-border-base flex items-center justify-center overflow-hidden rounded border",
        {
          "h-8 w-6": size === "base",
          "h-5 w-4": size === "small",
        }
      )}
    >
      {src ? (
        // These are full-resolution originals — the media store serves no
        // resized derivative and ignores width params, so a table of ten rows
        // pulls the originals (megabytes each) into a 24×32px box. Lazy +
        // async decode keeps that off the critical path so the table paints
        // instead of sitting blank while they download.
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-center"
        />
      ) : (
        <Photo className="text-ui-fg-subtle" />
      )}
    </div>
  )
}
