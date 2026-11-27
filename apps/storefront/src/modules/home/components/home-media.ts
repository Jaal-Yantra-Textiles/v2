import "server-only"

import {
  buildPublicMediaUrl,
  listPublicMedia,
  type PublicMedia,
} from "@lib/data/media"
import { GALLERY_ALBUM_ID } from "@lib/util/gallery"

export type HomeMediaImage = {
  id: string
  url: string
  alt: string
  title: string | null
  credit: string | null
}

/** One hero image + four grid images from the same draw. */
const HOME_MEDIA_COUNT = 5

function toHomeMediaImage(media: PublicMedia): HomeMediaImage | null {
  const url = buildPublicMediaUrl(media.file_path)

  if (!url) {
    return null
  }

  return {
    id: media.id,
    url,
    alt: media.alt_text || media.title || "Cici Label archive image",
    title: media.title || null,
    credit: media.caption || media.description || null,
  }
}

/**
 * One draw, two consumers: the first image backs the hero, the next four
 * fill the homepage media grid. Fetching a single batch through the shared
 * media API (`/web/media`) guarantees the grid never repeats the hero —
 * and never repeats itself — while `random: true` keeps the draw fresh on
 * each visit.
 *
 * The batch comes from the curated open-archive album (same source as the
 * hero, `/gallery` and the footer). If the album is short we top it up from
 * the general public pool and de-dupe by id, so the grid still fills before
 * an editor has curated the album.
 */
export async function getHomeMedia(): Promise<{
  hero: HomeMediaImage | null
  grid: HomeMediaImage[]
}> {
  const album = await listPublicMedia({
    limit: HOME_MEDIA_COUNT,
    type: "image",
    random: true,
    albumId: GALLERY_ALBUM_ID,
  }).catch(() => ({ medias: [] as PublicMedia[] }))

  const images = (album.medias || [])
    .map(toHomeMediaImage)
    .filter((image): image is HomeMediaImage => !!image)

  if (images.length < HOME_MEDIA_COUNT) {
    const pool = await listPublicMedia({
      limit: HOME_MEDIA_COUNT * 2,
      type: "image",
      random: true,
    }).catch(() => ({ medias: [] as PublicMedia[] }))

    const seen = new Set(images.map((image) => image.id))

    for (const media of pool.medias || []) {
      const image = toHomeMediaImage(media)

      if (!image || seen.has(image.id)) {
        continue
      }

      seen.add(image.id)
      images.push(image)

      if (images.length >= HOME_MEDIA_COUNT) {
        break
      }
    }
  }

  const [hero, ...grid] = images

  return { hero: hero ?? null, grid }
}
