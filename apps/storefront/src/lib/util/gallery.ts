/**
 * The curated "open archive" paintings collection. Resolved by the
 * backend's /web/media?album_id=… — the id works as an Album OR a public
 * media folder (the current prod set lives in the `media_art_hero`
 * folder). Shared by the homepage hero (one random draw) and the
 * /gallery page (the full set). Swappable without a redeploy via env.
 */
export const GALLERY_ALBUM_ID =
  process.env.NEXT_PUBLIC_HERO_ALBUM_ID ?? "01KS74M4JABCFKHB4WTF90KQYS"
