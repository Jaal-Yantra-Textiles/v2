import { Modules } from "@medusajs/utils"
import Scrypt from "scrypt-kdf"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

const SECOND_PASSWORD = "somepassword"

/**
 * Provision a second admin user directly through the container (mirroring the
 * createAdminUser helper, but with a distinct email that doesn't clobber the
 * shared testUserCredentials) and return its bearer headers — to prove
 * cross-user isolation.
 */
async function createSecondAdmin(container: any, api: any) {
  const unique = Math.random().toString(36).slice(2, 10)
  const email = `admin-asst2-${unique}@jyt.test`

  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const user = await userModule.createUsers({
    first_name: "Asst",
    last_name: "Two",
    email,
  })
  const passwordHash = await Scrypt.kdf(SECOND_PASSWORD, { logN: 15, r: 8, p: 1 })
  await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: passwordHash.toString("base64") },
      },
    ],
    app_metadata: { user_id: user.id },
  })

  const login = await api.post("/auth/user/emailpass", {
    email,
    password: SECOND_PASSWORD,
  })
  return { headers: { Authorization: `Bearer ${login.data.token}` } }
}

const SAMPLE_MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "Hello!" }] },
]

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin assistant conversation history API (#1092)", () => {
    let headers: Record<string, string>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = (await getAuthHeaders(api)).headers
    })

    it("creates a conversation and reads it back with messages", async () => {
      const post = await api.post(
        "/admin/assistant/conversations",
        { title: "Ops question", messages: SAMPLE_MESSAGES },
        { headers }
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.user_id).toBeTruthy()
      expect(post.data.conversation.title).toBe("Ops question")
      const id = post.data.conversation.id

      const get = await api.get(`/admin/assistant/conversations/${id}`, {
        headers,
      })
      expect(get.status).toBe(200)
      expect(get.data.conversation.messages).toHaveLength(2)
      expect(get.data.conversation.messages[0].parts[0].text).toBe("Hi")
    })

    it("defaults the title when omitted", async () => {
      const post = await api.post(
        "/admin/assistant/conversations",
        {},
        { headers }
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.title).toBe("New chat")
      expect(post.data.conversation.messages).toEqual([])
    })

    it("lists the user's conversations newest first (no message bodies)", async () => {
      await api.post(
        "/admin/assistant/conversations",
        { title: "First" },
        { headers }
      )
      await api.post(
        "/admin/assistant/conversations",
        { title: "Second" },
        { headers }
      )

      const list = await api.get("/admin/assistant/conversations", { headers })
      expect(list.status).toBe(200)
      expect(list.data.count).toBe(2)
      expect(list.data.conversations[0].title).toBe("Second")
      expect(list.data.conversations[0].messages).toBeUndefined()
    })

    it("PATCH renames and persists messages", async () => {
      const post = await api.post(
        "/admin/assistant/conversations",
        { title: "Untitled" },
        { headers }
      )
      const id = post.data.conversation.id

      const res = await api.patch(
        `/admin/assistant/conversations/${id}`,
        { title: "Renamed", messages: SAMPLE_MESSAGES },
        { headers }
      )
      expect(res.status).toBe(200)
      expect(res.data.conversation.title).toBe("Renamed")
      expect(res.data.conversation.messages).toHaveLength(2)
    })

    it("DELETE removes the conversation", async () => {
      const post = await api.post(
        "/admin/assistant/conversations",
        { title: "Doomed" },
        { headers }
      )
      const id = post.data.conversation.id

      const del = await api.delete(`/admin/assistant/conversations/${id}`, {
        headers,
      })
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      const get = await api
        .get(`/admin/assistant/conversations/${id}`, { headers })
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)
    })

    it("does not leak another user's conversation", async () => {
      const other = await createSecondAdmin(getContainer(), api)
      const post = await api.post(
        "/admin/assistant/conversations",
        { title: "Private" },
        { headers: other.headers }
      )
      const id = post.data.conversation.id

      const get = await api
        .get(`/admin/assistant/conversations/${id}`, { headers })
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)

      const list = await api.get("/admin/assistant/conversations", { headers })
      expect(list.data.conversations.some((c: any) => c.id === id)).toBe(false)
    })

    it("PATCH with an empty body is rejected (400)", async () => {
      const post = await api.post(
        "/admin/assistant/conversations",
        { title: "X" },
        { headers }
      )
      const id = post.data.conversation.id

      const res = await api
        .patch(`/admin/assistant/conversations/${id}`, {}, { headers })
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("requires admin authentication", async () => {
      const res = await api
        .get("/admin/assistant/conversations")
        .catch((e: any) => e.response)
      expect([401, 403]).toContain(res.status)
    })
  })
})
