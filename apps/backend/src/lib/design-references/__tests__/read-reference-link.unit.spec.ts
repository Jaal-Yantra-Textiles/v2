import {
  downloadReferenceImage,
  extractReferenceImages,
  MAX_IMAGES_PER_LINK,
  readReferenceLink,
  type Fetcher,
} from "../read-reference-link"
import { UnsafeUrlError } from "../../website-scan/safe-fetch"

const page = (html: string, url = "https://www.pinterest.com/pin/123/") =>
  ({ status: 200, url, contentType: "text/html; charset=utf-8", body: Buffer.from(html) })

const fetcherOf =
  (map: Record<string, ReturnType<typeof page> | Error>): Fetcher =>
  async (url) => {
    const hit = map[String(url)]
    if (!hit) throw new Error(`unexpected fetch ${url}`)
    if (hit instanceof Error) throw hit
    return hit
  }

const PIN_HTML = `<html><head>
  <title>Pin on Kurtas</title>
  <meta property="og:title" content="Indigo block-print kurta &amp; palazzo" />
  <meta property="og:description" content="Hand block printed cotton" />
  <meta property="og:image" content="https://i.pinimg.com/originals/ab/cd/kurta.jpg" />
  <meta name="twitter:image" content="https://i.pinimg.com/originals/ab/cd/kurta.jpg" />
</head><body></body></html>`

const SHOP_HTML = `<html><head>
  <meta property="og:image" content="//cdn.shop.example/hero.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Wool shawl",
    "image":["/img/1.jpg","/img/2.jpg","https://cdn.shop.example/hero.jpg"]}</script>
</head></html>`

describe("extractReferenceImages", () => {
  it("reads a Pinterest pin's card: one image, title decoded, duplicates folded", () => {
    const r = extractReferenceImages(PIN_HTML, "https://www.pinterest.com/pin/123/")
    expect(r.image_urls).toEqual(["https://i.pinimg.com/originals/ab/cd/kurta.jpg"])
    expect(r.title).toBe("Indigo block-print kurta & palazzo")
    expect(r.description).toBe("Hand block printed cotton")
  })

  it("adds a shop's Product images after the card, absolutised and deduped", () => {
    const r = extractReferenceImages(SHOP_HTML, "https://shop.example/p/shawl")
    expect(r.image_urls).toEqual([
      "https://cdn.shop.example/hero.jpg",
      "https://shop.example/img/1.jpg",
      "https://shop.example/img/2.jpg",
    ])
    expect(r.title).toBe("Wool shawl")
  })

  it(`never takes more than ${MAX_IMAGES_PER_LINK} images from one page`, () => {
    const imgs = (p: string) => Array.from({ length: 3 }, (_, i) => `"https://x.example/${p}${i}.jpg"`).join(",")
    const html = `<meta property="og:image" content="https://x.example/og.jpg">
      <script type="application/ld+json">[{"@type":"Product","name":"A","image":[${imgs("a")}]},
        {"@type":"Product","name":"B","image":[${imgs("b")}]}]</script>`
    expect(extractReferenceImages(html, "https://x.example/").image_urls).toHaveLength(MAX_IMAGES_PER_LINK)
  })
})

describe("readReferenceLink", () => {
  it("treats a direct image URL as the image itself", async () => {
    const url = "https://i.pinimg.com/x.jpg"
    const r = await readReferenceLink(url, fetcherOf({
      [url]: { status: 200, url, contentType: "image/jpeg", body: Buffer.from([0xff, 0xd8]) },
    }))
    expect(r).toMatchObject({ kind: "image", image_urls: [url] })
  })

  it("explains a login wall instead of returning nothing", async () => {
    const url = "https://www.instagram.com/p/abc/"
    await expect(
      readReferenceLink(url, fetcherOf({ [url]: page("<html><title>Login</title></html>", url) }))
    ).rejects.toThrow(/No picture could be found/)
    await expect(
      readReferenceLink(url, fetcherOf({ [url]: { ...page("", url), status: 403 } }))
    ).rejects.toThrow(/answered 403/)
  })

  it("passes an unsafe-URL refusal through untouched (the tool words it)", async () => {
    const url = "http://169.254.169.254/latest/meta-data"
    await expect(
      readReferenceLink(url, fetcherOf({ [url]: new UnsafeUrlError("private") }))
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it("🔴 really goes through the guarded fetcher by default — a metadata IP is refused", async () => {
    await expect(readReferenceLink("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
      UnsafeUrlError
    )
  })
})

describe("downloadReferenceImage", () => {
  it("refuses a page served where an image was expected", async () => {
    const url = "https://cdn.example/a.jpg"
    expect(await downloadReferenceImage(url, fetcherOf({ [url]: page("<html/>", url) }))).toBeNull()
  })

  it("keeps a real image with a filename from its type", async () => {
    const url = "https://cdn.example/a"
    const got = await downloadReferenceImage(url, fetcherOf({
      [url]: { status: 200, url, contentType: "image/webp", body: Buffer.from([1, 2, 3]) },
    }))
    expect(got?.mimeType).toBe("image/webp")
    expect(got?.filename).toMatch(/\.webp$/)
  })
})
