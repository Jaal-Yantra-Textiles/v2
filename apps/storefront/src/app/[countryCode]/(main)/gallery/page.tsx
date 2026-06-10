import { Heading, Text } from "@medusajs/ui"
import { Metadata } from "next"

import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import { GALLERY_ALBUM_ID } from "@lib/util/gallery"
import GalleryGrid, { GalleryPainting } from "@modules/gallery/gallery-grid"

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

  const paintings: GalleryPainting[] = (medias || [])
    .map((m) => ({
      id: m.id,
      url: buildPublicMediaUrl(m.file_path) || "",
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
          drawn from the New York Gallery&apos;s open archive. One greets
          you at random on every visit; this is all of them.
        </Text>
      </div>

      {paintings.length === 0 ? (
        <Text className="text-ui-fg-subtle">
          The archive is being rehung — check back soon.
        </Text>
      ) : (
        <>
          <GalleryGrid paintings={paintings} />
          <Text className="text-ui-fg-muted txt-small mt-10 block">
            All works are reproduced from the New York Gallery open
            archive. We share them in the same spirit they were opened —
            art that belongs to everyone.
          </Text>
        </>
      )}
    </div>
  )
}
