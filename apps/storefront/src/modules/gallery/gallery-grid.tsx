"use client"

import Image from "next/image"
import imageLoader from "@lib/util/image-loader"

export type GalleryPainting = {
  id: string
  url: string
  alt: string
  title: string | null
  credit: string | null
  width: number
  height: number
}

/**
 * Client component so next/image can take the custom Cloudflare-aware
 * loader (function props can't cross the RSC boundary — same reason the
 * homepage hero renders its painting inside HeroVisual).
 */
export default function GalleryGrid({
  paintings,
}: {
  paintings: GalleryPainting[]
}) {
  return (
    <div className="columns-1 small:columns-2 medium:columns-3 gap-6 [&>figure]:break-inside-avoid">
      {paintings.map((p) => (
        <figure key={p.id} className="mb-6">
          <Image
            loader={imageLoader}
            src={p.url}
            alt={p.alt}
            width={p.width}
            height={p.height}
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="w-full h-auto rounded-md shadow-elevation-card-rest"
          />
          {(p.title || p.credit) && (
            <figcaption className="mt-2 text-ui-fg-subtle txt-small">
              {p.title}
              {p.title && p.credit ? " — " : ""}
              {p.credit}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}
