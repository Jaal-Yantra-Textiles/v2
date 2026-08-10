import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

/**
 * Contract tests for POST /admin/assistant/summarize (#1238) — the admin twin of
 * the partner assistant's context compaction.
 *
 * Deliberately covers only auth and validation: a body that passes validation
 * calls a live model, which would make this suite slow, flaky and billable. The
 * summary text itself is not something an assertion can meaningfully pin.
 */
setupSharedTestSuite(() => {
  describe("Admin assistant — summarize (context compaction)", () => {
    const { api, getContainer } = getSharedTestEnv()

    beforeEach(async () => {
      await createAdminUser(getContainer())
    })

    it("requires admin authentication", async () => {
      const res = await api
        .post("/admin/assistant/summarize", {
          messages: [
            { role: "user", parts: [{ type: "text", text: "hello" }] },
            { role: "assistant", parts: [{ type: "text", text: "hi" }] },
          ],
        })
        .catch((e: any) => e.response)
      expect([401, 403]).toContain(res.status)
    })

    it("rejects a thread too short to be worth compacting", async () => {
      const headers = await getAuthHeaders(api)
      const res = await api
        .post(
          "/admin/assistant/summarize",
          { messages: [{ role: "user", parts: [{ type: "text", text: "only one" }] }] },
          headers
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("rejects a body with no messages at all", async () => {
      const headers = await getAuthHeaders(api)
      const res = await api
        .post("/admin/assistant/summarize", {}, headers)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })
  })
})
