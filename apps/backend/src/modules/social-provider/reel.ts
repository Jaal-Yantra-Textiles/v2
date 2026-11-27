import type { ReelOptions } from "./types"

/** Instagram's caption limits (Graph API): 2,200 characters and 30 hashtags. */
export const IG_CAPTION_MAX_CHARS = 2200
export const IG_CAPTION_MAX_HASHTAGS = 30

const VIDEO_EXT = /\.(mp4|mov|m4v)(\?|#|$)/i

/**
 * True when a media URL is a video by its extension. A post can carry an .mp4
 * in `media_urls` without `post_type: "reel"` — that lands as type "image"
 * and used to be sent to Instagram as a photo, which fails.
 */
export const isVideoUrl = (url: string | undefined | null): boolean =>
  typeof url === "string" && VIDEO_EXT.test(url)

/** Hashtags as Instagram counts them: `#` followed by a word. */
export const countHashtags = (caption: string): number =>
  (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length

/**
 * Reels options from a post's `metadata.reel`, keeping only what Instagram
 * accepts. `metadata` is not a contract, so every field is checked.
 */
export const readReelOptions = (metadata: unknown): ReelOptions | undefined => {
  const raw = (metadata as any)?.reel
  if (!raw || typeof raw !== "object") return undefined
  const out: ReelOptions = {}
  if (typeof raw.share_to_feed === "boolean") out.share_to_feed = raw.share_to_feed
  if (typeof raw.cover_url === "string" && /^https?:\/\//i.test(raw.cover_url)) out.cover_url = raw.cover_url
  const offset = Number(raw.thumb_offset)
  if (raw.thumb_offset !== undefined && raw.thumb_offset !== null && Number.isFinite(offset) && offset >= 0) {
    out.thumb_offset = Math.round(offset)
  }
  return Object.keys(out).length ? out : undefined
}

/** Why an Instagram caption would be refused, in plain words — or null. */
export const instagramCaptionProblem = (caption: string): string | null => {
  const chars = [...(caption || "")].length
  if (chars > IG_CAPTION_MAX_CHARS) {
    return `Instagram captions can be at most ${IG_CAPTION_MAX_CHARS} characters; this one is ${chars}.`
  }
  const tags = countHashtags(caption || "")
  if (tags > IG_CAPTION_MAX_HASHTAGS) {
    return `Instagram allows at most ${IG_CAPTION_MAX_HASHTAGS} hashtags; this caption has ${tags}.`
  }
  return null
}
