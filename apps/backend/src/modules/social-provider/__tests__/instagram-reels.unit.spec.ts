/**
 * Instagram Reels: video + caption, published through Instagram's container
 * flow (create → wait until processed → media_publish).
 *
 * Pinned here:
 * - the Reels container carries video_url, caption, media_type=REELS and the
 *   Reels options (share_to_feed, cover_url, thumb_offset);
 * - a Reel still processing after the in-request budget is PENDING, not
 *   failed, and carries the container id for the finish-instagram-reels job;
 * - the job's single check: FINISHED publishes, ERROR fails, an hour fails;
 * - video detection by URL, Reels options from metadata, caption limits.
 *
 * Graph calls are faked at `fetch`.
 */
import ContentPublishingService from "../content-publishing-service"
import InstagramService from "../instagram-service"
import { checkPendingReel, PENDING_REEL_MAX_AGE_MS } from "../finish-pending-reel"
import {
  countHashtags,
  instagramCaptionProblem,
  isVideoUrl,
  readReelOptions,
} from "../reel"

type Call = { url: string; method: string; body: URLSearchParams | null }

/** A fake Graph API: container create, status (scripted), publish, permalink. */
const fakeGraph = (statuses: string[]) => {
  const calls: Call[] = []
  let statusIdx = 0
  const fetchMock = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    const method = init?.method || "GET"
    const body = init?.body instanceof URLSearchParams ? init.body : null
    calls.push({ url, method, body })
    const json = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data })
    if (method === "POST" && url.endsWith("/media")) return json({ id: "cont_1" })
    if (method === "POST" && url.endsWith("/media_publish")) return json({ id: "media_9" })
    if (url.includes("fields=status_code")) {
      const code = statuses[Math.min(statusIdx++, statuses.length - 1)]
      return json({ status_code: code, status: code === "ERROR" ? "bad codec" : undefined })
    }
    if (url.includes("fields=permalink")) return json({ permalink: "https://www.instagram.com/reel/abc/" })
    return json({ error: { message: "unexpected" } }, false, 500)
  })
  return { calls, fetchMock }
}

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

const reelInput = (reel?: any) => ({
  platform: "instagram" as const,
  pageId: "",
  igUserId: "1789",
  userAccessToken: "tok",
  content: {
    type: "reel" as const,
    caption: "Handwoven in Kangra #handloom",
    video_url: "https://automatic.jaalyantra.com/automatica/reel.mp4",
    reel,
  },
})

describe("InstagramService — Reels container", () => {
  it("sends video_url, caption, media_type=REELS and the Reels options", async () => {
    const { calls, fetchMock } = fakeGraph(["FINISHED"])
    global.fetch = fetchMock as any
    await new InstagramService().startReel(
      "1789",
      { video_url: "https://x/v.mp4", caption: "hi", share_to_feed: false, cover_url: "https://x/c.jpg", thumb_offset: 1500.4 },
      "tok"
    )
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/1789/media"))!
    expect(create.body!.get("media_type")).toBe("REELS")
    expect(create.body!.get("video_url")).toBe("https://x/v.mp4")
    expect(create.body!.get("caption")).toBe("hi")
    expect(create.body!.get("share_to_feed")).toBe("false")
    expect(create.body!.get("cover_url")).toBe("https://x/c.jpg")
    expect(create.body!.get("thumb_offset")).toBe("1500")
  })

  it("pollContainer returns IN_PROGRESS after its budget instead of throwing", async () => {
    const { fetchMock } = fakeGraph(["IN_PROGRESS"])
    global.fetch = fetchMock as any
    const status = await new InstagramService().pollContainer("cont_1", "tok", { attempts: 3, delayMs: 0 })
    expect(status.status_code).toBe("IN_PROGRESS")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe("ContentPublishingService — Instagram Reel", () => {
  const service = () => {
    const s = new ContentPublishingService()
    s.reelWait = { attempts: 2, delayMs: 0 }
    return s
  }

  it("publishes once Instagram finishes, with the permalink", async () => {
    const { calls, fetchMock } = fakeGraph(["IN_PROGRESS", "FINISHED"])
    global.fetch = fetchMock as any
    const res = await service().publishContent(reelInput({ share_to_feed: true }))
    expect(res.results).toEqual([
      { platform: "instagram", success: true, postId: "media_9", permalink: "https://www.instagram.com/reel/abc/" },
    ])
    expect(calls.some((c) => c.url.endsWith("/1789/media_publish"))).toBe(true)
  })

  it("hands a still-processing Reel off as PENDING with its container — no publish, no failure", async () => {
    const { calls, fetchMock } = fakeGraph(["IN_PROGRESS"])
    global.fetch = fetchMock as any
    const res = await service().publishContent(reelInput())
    expect(res.results).toEqual([
      { platform: "instagram", success: false, pending: true, containerId: "cont_1", igUserId: "1789" },
    ])
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false)
  })

  it("reports a video Instagram cannot process as a failure with the reason", async () => {
    const { fetchMock } = fakeGraph(["ERROR"])
    global.fetch = fetchMock as any
    const res = await service().publishContent(reelInput())
    expect(res.results[0]).toMatchObject({ platform: "instagram", success: false })
    expect(res.results[0].error).toContain("ERROR: bad codec")
    expect((res.results[0] as any).pending).toBeUndefined()
  })
})

describe("checkPendingReel — the finish-instagram-reels job's single check", () => {
  const pending = { container_id: "cont_1", ig_user_id: "1789", started_at: new Date().toISOString() }
  const ig = () => new InstagramService()

  it("FINISHED → published, with media id and permalink", async () => {
    global.fetch = fakeGraph(["FINISHED"]).fetchMock as any
    await expect(checkPendingReel(pending, "tok", ig())).resolves.toEqual({
      kind: "posted",
      media_id: "media_9",
      permalink: "https://www.instagram.com/reel/abc/",
    })
  })

  it("ERROR → failed with the reason", async () => {
    global.fetch = fakeGraph(["ERROR"]).fetchMock as any
    const out = await checkPendingReel(pending, "tok", ig())
    expect(out.kind).toBe("failed")
    expect((out as any).error).toContain("bad codec")
  })

  it("still processing → left alone, until it is older than an hour", async () => {
    global.fetch = fakeGraph(["IN_PROGRESS"]).fetchMock as any
    await expect(checkPendingReel(pending, "tok", ig())).resolves.toEqual({ kind: "still-processing" })
    const later = new Date(Date.now() + PENDING_REEL_MAX_AGE_MS + 60_000)
    await expect(checkPendingReel(pending, "tok", ig(), later)).resolves.toMatchObject({ kind: "failed" })
  })
})

describe("Reel helpers", () => {
  it("detects a video by its URL, query string or not", () => {
    expect(isVideoUrl("https://x/a.mp4")).toBe(true)
    expect(isVideoUrl("https://x/a.MOV?sig=1")).toBe(true)
    expect(isVideoUrl("https://x/a.m4v#t=2")).toBe(true)
    expect(isVideoUrl("https://x/a.jpg")).toBe(false)
    expect(isVideoUrl("https://x/mp4-guide.jpg")).toBe(false)
    expect(isVideoUrl(undefined)).toBe(false)
  })

  it("reads only valid Reels options from metadata", () => {
    expect(readReelOptions({ reel: { share_to_feed: false, cover_url: "https://x/c.jpg", thumb_offset: "2000" } })).toEqual({
      share_to_feed: false,
      cover_url: "https://x/c.jpg",
      thumb_offset: 2000,
    })
    expect(readReelOptions({ reel: { share_to_feed: "no", cover_url: "javascript:x", thumb_offset: -5 } })).toBeUndefined()
    expect(readReelOptions({})).toBeUndefined()
    expect(readReelOptions(null)).toBeUndefined()
  })

  it("enforces Instagram's caption limits: 2,200 characters, 30 hashtags", () => {
    expect(countHashtags("Handwoven #handloom #kangra and #slow_fashion, not a#tag")).toBe(3)
    expect(instagramCaptionProblem("x".repeat(2200))).toBeNull()
    expect(instagramCaptionProblem("x".repeat(2201))).toContain("2200 characters")
    expect(instagramCaptionProblem(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "))).toContain("30 hashtags")
    expect(instagramCaptionProblem(Array.from({ length: 30 }, (_, i) => `#t${i}`).join(" "))).toBeNull()
  })
})
