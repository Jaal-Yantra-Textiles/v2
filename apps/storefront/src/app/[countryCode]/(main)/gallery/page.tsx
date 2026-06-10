import { Heading, Text } from "@medusajs/ui"
import { Metadata } from "next"
import Image from "next/image"

import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import { GALLERY_ALBUM_ID } from "@lib/util/gallery"
import imageLoader from "@lib/util/image-loader"

export const metadata: Metadata = {
  title: "Gallery — The Open Archive",
  description:
    "The open-archive paintings behind Cici Label's homepage — the full curated collection.",
}

/**
 * The full open-archive collection the homepage hero draws from — every
 * painting, not just one random pick per visit. Server-rendered; a CSS
 * column layout keeps each painting's native aspect ratio (no crops).
 */
export default async function GalleryPage() {
  const { medias } = await listPublicMedia({
    limit: 100,
    type: "image",
    random: false,
    albumId: GALLERY_ALBUM_ID,
  }).catch(() => ({ medias: [] as any[] }))

  const paintings = (medias || [])
    .map((m) => ({
      id: m.id,
      url: buildPublicMediaUrl(m.file_path),
      alt: m.alt_text || m.title || "Open archive painting",
      title: m.title || null,
      credit: m.caption || m.description || null,
      width: m.width || 1200,
      height: m.height || 900,
    }))
    .filter((p) => !!p.url)

  return (
    <div className="content-container py-12">
      <div className="mb-10 max-w-xl">
        <Heading level="h1" className="mb-3">
          The Open Archive
        </Heading>
        <Text className="text-ui-fg-subtle">
          The paintings behind our homepage — a small, rotating collection
          drawn from open archives. One greets you at random on every
          visit; this is all of them.
        </Text>
      </div>

      {paintings.length === 0 ? (
        <Text className="text-ui-fg-subtle">
          The archive is being rehung — check back soon.
        </Text>
      ) : (
        <div className="columns-1 small:columns-2 medium:columns-3 gap-6 [&>figure]:break-inside-avoid">
          {paintings.map((p) => (
            <figure key={p.id} className="mb-6">
              <Image
                loader={imageLoader}
                src={p.url!}
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
      )}
    </div>
  )
}
