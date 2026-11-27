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

/** The media-library folder the homepage grid draws from (not the art album). */
export const HOME_GRID_FOLDER_ID =
  process.env.NEXT_PUBLIC_HOME_GRID_FOLDER_ID || "01M63K22VHDZC68PA6RK71ZZ4B"

const GRID_COUNT = 4

const toImages = (medias: PublicMedia[] | undefined) =>
  (medias || [])
    .map(toHomeMediaImage)
    .filter((image): image is HomeMediaImage => !!image)

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
 * Two sources: the hero is one random painting from the curated open-archive
 * album (same source as `/gallery`); the grid is four random photos from the
 * homepage grid FOLDER — cloth, hands and places, not the paintings. Both use
 * the shared public media API (`/web/media`, which accepts a folder id as
 * `album_id`); `random: true` keeps each visit fresh.
 *
 * Empty sources degrade quietly: no hero image → the gradient hero; an empty
 * folder → the strip renders nothing. The grid never falls back to the art
 * pool, so a painting can't show up where photos belong.
 */
export async function getHomeMedia(): Promise<{
  hero: HomeMediaImage | null
  grid: HomeMediaImage[]
}> {
  const [heroDraw, gridDraw] = await Promise.all([
    listPublicMedia({
      limit: 1,
      type: "image",
      random: true,
      albumId: GALLERY_ALBUM_ID,
    }).catch(() => ({ medias: [] as PublicMedia[] })),
    listPublicMedia({
      limit: GRID_COUNT,
      type: "image",
      random: true,
      albumId: HOME_GRID_FOLDER_ID,
    }).catch(() => ({ medias: [] as PublicMedia[] })),
  ])

  const [hero] = toImages(heroDraw.medias)
  const grid = toImages(gridDraw.medias).slice(0, GRID_COUNT)

  return { hero: hero ?? null, grid }
}
