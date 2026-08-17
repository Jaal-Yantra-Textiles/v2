import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any, tag: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-asst-${tag}-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `AsstTest ${unique}`,
      handle: `assttest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Asst" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the bearer token carries partner actor context.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId }
}

const SAMPLE_MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "Hello!" }] },
]

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner assistant conversation history API (#338)", () => {
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      await getAuthHeaders(api)
      partner = await createPartner(api, "a")
    })

    it("creates a conversation and reads it back with messages", async () => {
      const post = await api.post(
        "/partners/assistant/conversations",
        { title: "Onboarding help", messages: SAMPLE_MESSAGES },
        { headers: partner.headers }
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.partner_id).toBe(partner.partnerId)
      expect(post.data.conversation.title).toBe("Onboarding help")
      const id = post.data.conversation.id

      const get = await api.get(
        `/partners/assistant/conversations/${id}`,
        { headers: partner.headers }
      )
      expect(get.status).toBe(200)
      expect(get.data.conversation.messages).toHaveLength(2)
      expect(get.data.conversation.messages[0].parts[0].text).toBe("Hi")
    })

    it("defaults the title when omitted", async () => {
      const post = await api.post(
        "/partners/assistant/conversations",
        {},
        { headers: partner.headers }
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.title).toBe("New chat")
      expect(post.data.conversation.messages).toEqual([])
    })

    it("lists the partner's conversations newest first (no message bodies)", async () => {
      await api.post(
        "/partners/assistant/conversations",
        { title: "First" },
        { headers: partner.headers }
      )
      await api.post(
        "/partners/assistant/conversations",
        { title: "Second" },
        { headers: partner.headers }
      )

      const list = await api.get("/partners/assistant/conversations", {
        headers: partner.headers,
      })
      expect(list.status).toBe(200)
      expect(list.data.count).toBe(2)
      // newest first
      expect(list.data.conversations[0].title).toBe("Second")
      // list is light — no message bodies
      expect(list.data.conversations[0].messages).toBeUndefined()
    })

    it("PATCH renames and persists messages", async () => {
      const post = await api.post(
        "/partners/assistant/conversations",
        { title: "Untitled" },
        { headers: partner.headers }
      )
      const id = post.data.conversation.id

      const res = await api.patch(
        `/partners/assistant/conversations/${id}`,
        { title: "Renamed", messages: SAMPLE_MESSAGES },
        { headers: partner.headers }
      )
      expect(res.status).toBe(200)
      expect(res.data.conversation.title).toBe("Renamed")
      expect(res.data.conversation.messages).toHaveLength(2)
    })

    it("persists thread_key and KEEPS it through later message-only PATCHes", async () => {
      // thread_key ties a conversation to the photos uploaded during it. It is
      // written once, on the first save, and every later PATCH sends only
      // title/messages — so a metadata write that REPLACED rather than merged
      // would silently drop it on the very next turn and orphan the photos.
      // The reopened conversation would then look fine and simply have no
      // photos, which is exactly the kind of failure nobody reports as a bug.
      const post = await api.post(
        "/partners/assistant/conversations",
        {
          title: "Pashmina photos",
          messages: SAMPLE_MESSAGES,
          metadata: { thread_key: "chat_abc123" },
        },
        { headers: partner.headers }
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.metadata?.thread_key).toBe("chat_abc123")
      const id = post.data.conversation.id

      // A normal follow-up turn: messages only, no metadata.
      const patched = await api.patch(
        `/partners/assistant/conversations/${id}`,
        {
          messages: [
            ...SAMPLE_MESSAGES,
            { id: "m3", role: "user", parts: [{ type: "text", text: "More" }] },
          ],
        },
        { headers: partner.headers }
      )
      expect(patched.status).toBe(200)
      expect(patched.data.conversation.messages).toHaveLength(3)
      expect(patched.data.conversation.metadata?.thread_key).toBe("chat_abc123")

      // And a metadata PATCH must not wipe sibling keys either.
      await api.patch(
        `/partners/assistant/conversations/${id}`,
        { metadata: { something_else: true } },
        { headers: partner.headers }
      )
      const get = await api.get(
        `/partners/assistant/conversations/${id}`,
        { headers: partner.headers }
      )
      expect(get.data.conversation.metadata?.thread_key).toBe("chat_abc123")
      expect(get.data.conversation.metadata?.something_else).toBe(true)
    })

    it("DELETE removes the conversation", async () => {
      const post = await api.post(
        "/partners/assistant/conversations",
        { title: "Doomed" },
        { headers: partner.headers }
      )
      const id = post.data.conversation.id

      const del = await api.delete(
        `/partners/assistant/conversations/${id}`,
        { headers: partner.headers }
      )
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      const get = await api
        .get(`/partners/assistant/conversations/${id}`, {
          headers: partner.headers,
        })
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)
    })

    it("does not leak another partner's conversation", async () => {
      const other = await createPartner(api, "b")
      const post = await api.post(
        "/partners/assistant/conversations",
        { title: "Private" },
        { headers: other.headers }
      )
      const id = post.data.conversation.id

      // partner A cannot read partner B's conversation
      const get = await api
        .get(`/partners/assistant/conversations/${id}`, {
          headers: partner.headers,
        })
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)

      // ...and it doesn't show in A's list
      const list = await api.get("/partners/assistant/conversations", {
        headers: partner.headers,
      })
      expect(list.data.conversations.some((c: any) => c.id === id)).toBe(false)
    })

    it("PATCH with an empty body is rejected (400)", async () => {
      const post = await api.post(
        "/partners/assistant/conversations",
        { title: "X" },
        { headers: partner.headers }
      )
      const id = post.data.conversation.id

      const res = await api
        .patch(
          `/partners/assistant/conversations/${id}`,
          {},
          { headers: partner.headers }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("requires partner authentication", async () => {
      const res = await api
        .get("/partners/assistant/conversations")
        .catch((e: any) => e.response)
      expect([401, 403]).toContain(res.status)
    })
  })
})
