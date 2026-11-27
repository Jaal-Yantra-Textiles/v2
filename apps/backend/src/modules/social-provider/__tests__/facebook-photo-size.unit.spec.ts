import FacebookService from "../facebook-service"
import { FACEBOOK_MAX_PHOTO_BYTES, transformForFacebook } from "../image-transformer"

/**
 * spost 01M8EHEW003KS4AT3RJVMMY2CK (2026-11-27): the album carried four camera
 * JPEGs of 18–23 MB. Facebook fetched them by URL, rejected the first with
 * 100/1366046 "Can't read files … less than 10 MB", and the whole Facebook
 * post failed (Instagram, sent separately, went through).
 *
 * Measured against the real asset host: 23.3 MB DSC JPEG → 1.18 MB through
 * /cdn-cgi/image/width=2048,…,format=jpeg.
 */

const BIG = "https://automatic.jaalyantra.com/automatica/DSC_0649-c5c17c03f0ebb8fa.JPG"

describe("transformForFacebook", () => {
  it("states Facebook's ceiling as the real one", () => {
    expect(FACEBOOK_MAX_PHOTO_BYTES).toBe(10485760)
  })

  it("resizes our media to a scaled-down JPEG without cropping", () => {
    const out = transformForFacebook(BIG)
    expect(out).toBe(
      "https://automatic.jaalyantra.com/cdn-cgi/image/width=2048,fit=scale-down,quality=85,format=jpeg/automatica/DSC_0649-c5c17c03f0ebb8fa.JPG"
    )
  })

  it("leaves an already-resized URL alone (a rewrite of a rewrite 404s)", () => {
    const once = transformForFacebook(BIG)
    expect(transformForFacebook(once)).toBe(once)
  })

  it("leaves someone else's URL alone", () => {
    const other = "https://images.example.org/a.jpg"
    expect(transformForFacebook(other)).toBe(other)
  })
})

describe("FacebookService photo uploads send the resized URL", () => {
  const realFetch = global.fetch
  let sentUrls: string[] = []

  beforeEach(() => {
    sentUrls = []
    global.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input)
      const body = new URLSearchParams(String(init?.body ?? ""))
      if (url.endsWith("/photos")) {
        sentUrls.push(body.get("url") || "")
        return new Response(JSON.stringify({ id: `ph_${sentUrls.length}`, post_id: "p_1" }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: "post_1" }), { status: 200 })
    }) as any
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it("album: every photo goes up through the resizer", async () => {
    const fb = new FacebookService()
    await fb.createPagePhotoAlbum("747917475065823", { message: "m", image_urls: [BIG, BIG.replace("0649", "0652")] }, "tok")
    expect(sentUrls).toHaveLength(2)
    for (const u of sentUrls) expect(u).toContain("/cdn-cgi/image/width=2048,fit=scale-down,quality=85,format=jpeg/")
  })

  it("single photo: goes up through the resizer", async () => {
    const fb = new FacebookService()
    await fb.createPagePhotoPost("747917475065823", { message: "m", image_url: BIG }, "tok")
    expect(sentUrls).toEqual([transformForFacebook(BIG)])
  })
})
