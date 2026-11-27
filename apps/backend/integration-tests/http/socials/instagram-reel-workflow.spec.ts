/**
 * The Instagram Reel as a LONG-RUNNING workflow, end to end through the real
 * admin routes and the real workflow engine — only Instagram's Graph API is
 * faked (at `fetch`).
 *
 * Pinned:
 * - saving a post with media (no auto_publish) does not publish it;
 * - publish returns at once with pending:true; the post is `scheduled` with
 *   insights.instagram_reel { transaction_id, stage: "processing" };
 * - the background wait step moves it to "awaiting_confirmation" once
 *   Instagram reports FINISHED — and NOTHING is published before confirm;
 * - publishing again while it is in progress is refused;
 * - POST /reel/confirm resumes the workflow: media_publish, post `posted`,
 *   permalink stored, marker cleared;
 * - Instagram reporting ERROR fails the workflow for good: post `failed`,
 *   marker cleared, nothing published.
 */
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(180 * 1000)

type GraphCall = { url: string; method: string; body?: string }

const realFetch = global.fetch
let graphCalls: GraphCall[] = []
let containerStatus = "FINISHED"

/** Intercepts graph.facebook.com only; everything else goes to the network. */
const installFakeGraph = () => {
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    // Exact host, not a substring: only Instagram's Graph API is faked.
    let host = ""
    try {
      host = new URL(url).hostname
    } catch {
      // not an absolute URL — not a Graph call
    }
    if (host !== "graph.facebook.com") return realFetch(input, init)
    const method = init?.method || "GET"
    graphCalls.push({ url, method, body: init?.body ? String(init.body) : undefined })
    const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } })
    if (method === "POST" && /\/media$/.test(url.split("?")[0])) return json({ id: "cont_reel_1" })
    if (method === "POST" && url.includes("/media_publish")) return json({ id: "media_reel_9" })
    if (url.includes("fields=status_code")) return json({ status_code: containerStatus, status: containerStatus === "ERROR" ? "bad codec" : undefined })
    if (url.includes("fields=permalink")) return json({ permalink: "https://www.instagram.com/reel/test/" })
    return new Response(JSON.stringify({ error: { message: "unexpected graph call" } }), { status: 500 })
  }) as any
}

const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20000): Promise<T> => {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > until) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 250))
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Instagram Reel — long-running publish workflow", () => {
    let headers: any
    let platformId: string

    const createReelPost = async (name: string) => {
      const res = await api.post(
        "/admin/social-posts",
        {
          name,
          platform_id: platformId,
          platform_name: "instagram",
          post_type: "reel",
          message: "Handwoven in Kangra #handloom",
          media_urls: ["https://automatic.jaalyantra.com/automatica/reel.mp4"],
          metadata: { ig_user_id: "1789", reel: { share_to_feed: true, thumb_offset: 2000 } },
        },
        headers
      )
      return res.data.socialPost.id as string
    }
    const getPost = async (id: string) => (await api.get(`/admin/social-posts/${id}`, headers)).data.socialPost

    beforeEach(async () => {
      graphCalls = []
      containerStatus = "FINISHED"
      installFakeGraph()
      await createAdminUser(getContainer())
      headers = await getAuthHeaders(api)
      const platform = await api.post(
        "/admin/social-platforms",
        { name: "instagram", category: "social", api_config: { access_token: "test-token" } },
        headers
      )
      platformId = platform.data.socialPlatform.id
    })

    afterEach(() => {
      global.fetch = realFetch
    })

    it("processes in the background, waits for confirmation, then publishes", async () => {
      const id = await createReelPost("Reel happy path")

      // Saving a post with media but no auto_publish must NOT publish it
      // (the created-hook used to post anything with media attached).
      await new Promise((r) => setTimeout(r, 500))
      expect(graphCalls).toHaveLength(0)
      expect((await getPost(id)).status).toBe("draft")

      const pub = await api.post(`/admin/social-posts/${id}/publish`, {}, headers)
      expect(pub.data.pending).toBe(true)

      const queued = await getPost(id)
      expect(queued.status).toBe("scheduled")
      expect(queued.insights.instagram_reel.transaction_id).toBeTruthy()

      // The container went up with the Reels options; nothing is live yet.
      const create = graphCalls.find((c) => c.method === "POST" && /\/1789\/media$/.test(c.url))!
      expect(create.body).toContain("media_type=REELS")
      expect(create.body).toContain("thumb_offset=2000")

      const ready = await waitFor(async () => {
        const p = await getPost(id)
        return p.insights?.instagram_reel?.stage === "awaiting_confirmation" && p
      })
      expect(ready.status).toBe("scheduled")
      expect(graphCalls.some((c) => c.url.includes("/media_publish"))).toBe(false)

      // Publishing again while it is in progress is refused.
      const again = await api.post(`/admin/social-posts/${id}/publish`, {}, headers).catch((e) => e.response)
      expect(again.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(again.data)).toContain("waiting for confirmation")

      await api.post(`/admin/social-posts/${id}/reel/confirm`, {}, headers)

      const posted = await waitFor(async () => {
        const p = await getPost(id)
        return p.status === "posted" && p
      })
      expect(posted.insights.instagram_permalink).toBe("https://www.instagram.com/reel/test/")
      expect(posted.insights.instagram_media_id).toBe("media_reel_9")
      expect(posted.insights.instagram_reel).toBeFalsy() // cleared to null (insights merges on update)
      expect(graphCalls.filter((c) => c.url.includes("/media_publish"))).toHaveLength(1)
    })

    it("refuses to confirm while Instagram is still processing", async () => {
      containerStatus = "IN_PROGRESS"
      const id = await createReelPost("Reel still processing")
      await api.post(`/admin/social-posts/${id}/publish`, {}, headers)
      const res = await api.post(`/admin/social-posts/${id}/reel/confirm`, {}, headers).catch((e) => e.response)
      expect(res.status).toBe(409)
      expect(graphCalls.some((c) => c.url.includes("/media_publish"))).toBe(false)
    })

    it("a video Instagram cannot process fails the post for good — nothing published", async () => {
      containerStatus = "ERROR"
      const id = await createReelPost("Reel bad video")
      await api.post(`/admin/social-posts/${id}/publish`, {}, headers)

      const failed = await waitFor(async () => {
        const p = await getPost(id)
        return p.status === "failed" && p
      })
      expect(failed.insights.instagram_reel).toBeFalsy() // cleared to null
      expect(failed.error_message).toContain("instagram")
      expect(graphCalls.some((c) => c.url.includes("/media_publish"))).toBe(false)
    })
  })
})
