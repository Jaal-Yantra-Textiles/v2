import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import { GALLERY_ALBUM_ID } from "@lib/util/gallery"
import HeroVisual from "./hero-visual"

/**
 * Pulls one random public image from the hero album each request.
 *
 * The album is configured via `NEXT_PUBLIC_HERO_ALBUM_ID` so it stays
 * swappable without a redeploy when an editor curates a new collection
 * (default points at the current "hero paintings" album). When the env
 * var is unset OR the album is empty, falls back to the existing
 * random-public-media behaviour so the page never renders blank.
 *
 * `random=true` + `cache:"no-store"` (set inside listPublicMedia) means
 * every page load gets a fresh draw — that's why the env var includes a
 * default rather than relying on the public album being created up
 * front. Editors can rotate the curated set by adding / removing media
 * from the album in admin.
 */
const HERO_ALBUM_ID = GALLERY_ALBUM_ID

const Hero = async () => {
  const isDev = process.env.NODE_ENV === "development"

  const result = isDev
    ? { medias: [] as any[] }
    : await listPublicMedia({
        limit: 1,
        type: "image",
        random: true,
        albumId: HERO_ALBUM_ID,
      }).catch(() => ({ medias: [] }))

  // Fall back to the un-scoped random pool if the album is empty so we
  // don't end up with no image — this matters most during the window
  // between deploying this code and an editor populating the album.
  const medias = result.medias?.length
    ? result.medias
    : isDev
      ? []
      : (
          await listPublicMedia({
            limit: 1,
            type: "image",
            random: true,
          }).catch(() => ({ medias: [] }))
        ).medias

  const first = medias?.[0]
  const imageUrl = first ? buildPublicMediaUrl(first.file_path) : null
  const alt = first?.alt_text || first?.title || "Cici Label"
  const credit = first?.caption || first?.description || null

  return <HeroVisual imageUrl={imageUrl} alt={alt} credit={credit} />
}

export default Hero
