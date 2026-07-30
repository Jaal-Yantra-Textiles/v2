import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"


/**
 * This spec used to target `POST /admin/ai/chat` and `GET /admin/ai/chat/stream`.
 * Both routes were DELETED in 92bc280bb ("consolidate AI chat, ..."), which
 * folded the admin chat into `/admin/ai/chat/chat` and dropped the SSE endpoint
 * without a like-for-like replacement. The spec was never updated, and because
 * the main gate skipped every test for months (#1187) nothing noticed — all four
 * tests here and in ai-chat-stability.spec.ts were 404ing.
 *
 * Retargeted at the consolidated route. Note the envelope changed too: the
 * response is `{ status, runId, result: { reply, ... }, meta }` — there is no
 * top-level `message` field, which the old assertions also expected.
 *
 * Streaming is NOT re-covered here: the SSE surface this file used to exercise
 * no longer exists. Streaming now happens over `POST /admin/assistant/chat`
 * (AI SDK `streamText` piped as a UI message stream), a different contract on a
 * different route, and asserting it here would mean inventing one.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  describe("GET /admin/ai/chat/chat", () => {
    it("reports V4 status and configuration", async () => {
      const res = await api.get("/admin/ai/chat/chat", headers)

      expect(res.status).toBe(200)
      expect(res.data.status).toBe("ok")
      expect(res.data.version).toBe("v4")
    })
  })

  describe("POST /admin/ai/chat/chat", () => {
    it("responds with a reply and optional toolCalls fields", async () => {
      const res = await api.post(
        "/admin/ai/chat/chat",
        { message: "Hello there!" },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.status).toBe("completed")
      expect(res.data.result).toBeDefined()
      expect(typeof res.data.result.reply).toBe("string")

      // Optional shape checks — present only for some resolution modes.
      if (res.data.result.toolCalls) {
        expect(Array.isArray(res.data.result.toolCalls)).toBe(true)
      }
      if (res.data.result.steps) {
        expect(Array.isArray(res.data.result.steps)).toBe(true)
      }
    })

    it("rejects a request with no message", async () => {
      const res = await api
        .post("/admin/ai/chat/chat", {}, headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(400)
    })
  })
})
