/**
 * Read a reference link a maker pastes into the design chat.
 *
 * A maker rarely has a clean image URL. They have a Pinterest pin, an
 * Instagram post, a product page on someone's shop. This turns any of those
 * into the handful of images that actually show the garment:
 *
 *   - a direct image URL → that image
 *   - a page → its Open Graph / Twitter card image, then the images of any
 *     schema.org `Product` on it (shop pages), then `<link rel="image_src">`
 *
 * 🔴 The page is fetched by OUR server, from a URL a stranger typed. Every
 * request goes through `safeFetch`, which vets the address the socket actually
 * connects to (no 169.254.169.254, no 10.x, no redirect inward). Never swap it
 * for a plain `fetch`.
 *
 * 🔑 The images are COPIED into our own storage before they are pinned.
 * Instagram and many CDNs serve signed URLs that expire within days; a board
 * that hot-links them goes blank, and the vision provider cannot read a dead
 * link either.
 */
import {
  absolutize,
  decodeEntities,
  extractJsonLdProducts,
  metaContent,
} from "../website-scan/read-catalogue"
import { safeFetch, type SafeFetchResult } from "../website-scan/safe-fetch"

export const REFERENCE_USER_AGENT =
  "Mozilla/5.0 (compatible; JYT-DesignReference/1.0; +https://jaalyantra.com; reads a link a customer shared as design inspiration)"

/** Images taken from ONE link. A page with 30 photos is a catalogue, not a reference. */
export const MAX_IMAGES_PER_LINK = 4
const MAX_PAGE_BYTES = 3 * 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|avif)\b/i

export type ReferenceLinkRead = {
  /** The URL after redirects. */
  page_url: string
  kind: "image" | "page"
  title: string | null
  description: string | null
  /** Absolute, deduped, at most MAX_IMAGES_PER_LINK. Not yet copied. */
  image_urls: string[]
}

export type Fetcher = (
  url: string,
  options: Parameters<typeof safeFetch>[1]
) => Promise<SafeFetchResult>

const titleTag = (html: string): string | null => {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)
  return m ? decodeEntities(m[1]).trim() || null : null
}

const linkImageSrc = (html: string, pageUrl: string): string | null => {
  const m =
    html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']image_src["']/i)
  return m ? absolutize(decodeEntities(m[1]), pageUrl) : null
}

/**
 * The garment images a page offers, best first. Pure — no network — so the
 * parsing is testable against saved HTML.
 */
export const extractReferenceImages = (
  html: string,
  pageUrl: string
): Omit<ReferenceLinkRead, "kind"> => {
  const candidates: Array<string | null> = [
    absolutize(metaContent(html, "og:image:secure_url"), pageUrl),
    absolutize(metaContent(html, "og:image"), pageUrl),
    absolutize(metaContent(html, "twitter:image"), pageUrl),
    absolutize(metaContent(html, "twitter:image:src"), pageUrl),
  ]
  const products = extractJsonLdProducts(html, pageUrl)
  for (const p of products) candidates.push(...p.images)
  candidates.push(linkImageSrc(html, pageUrl))

  const image_urls = [
    ...new Set(candidates.filter((u): u is string => !!u && /^https?:\/\//i.test(u))),
  ].slice(0, MAX_IMAGES_PER_LINK)

  const title =
    metaContent(html, "og:title")?.trim() || products[0]?.title || titleTag(html)
  const description =
    metaContent(html, "og:description")?.trim() ||
    products[0]?.description ||
    metaContent(html, "description")?.trim() ||
    null

  return {
    page_url: pageUrl,
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 600) : null,
    image_urls,
  }
}

/**
 * Fetch a pasted link and say which images it holds. Throws `UnsafeUrlError`
 * for a URL that must not be fetched, and a plain Error when the link cannot
 * be read — the caller turns either into words for the maker.
 */
export const readReferenceLink = async (
  rawUrl: string,
  fetcher: Fetcher = safeFetch
): Promise<ReferenceLinkRead> => {
  const res = await fetcher(rawUrl, {
    maxBytes: MAX_PAGE_BYTES,
    accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5",
    userAgent: REFERENCE_USER_AGENT,
  })
  if (res.status >= 400) {
    throw new Error(`The link answered ${res.status} — it may be private or need a login.`)
  }

  if (IMAGE_TYPES.test(res.contentType)) {
    return { page_url: res.url, kind: "image", title: null, description: null, image_urls: [res.url] }
  }

  const html = res.body.toString("utf8")
  const read = extractReferenceImages(html, res.url)
  if (!read.image_urls.length) {
    throw new Error(
      "No picture could be found on that page (it may need a login). Ask the maker to upload a screenshot instead."
    )
  }
  return { ...read, kind: "page" }
}

/**
 * Download one image through the same guarded fetcher. Returns null for
 * anything that is not a real image — a login page served with a 200 must not
 * be stored as a "photo".
 */
export const downloadReferenceImage = async (
  url: string,
  fetcher: Fetcher = safeFetch
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> => {
  const res = await fetcher(url, {
    maxBytes: MAX_IMAGE_BYTES,
    accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    userAgent: REFERENCE_USER_AGENT,
  })
  if (res.status >= 400 || !IMAGE_TYPES.test(res.contentType) || !res.body.length) {
    return null
  }
  const mimeType = res.contentType.split(";")[0].trim().toLowerCase()
  const ext = mimeType.split("/")[1].replace("jpeg", "jpg")
  return { buffer: res.body, mimeType, filename: `reference-${Date.now()}.${ext}` }
}
