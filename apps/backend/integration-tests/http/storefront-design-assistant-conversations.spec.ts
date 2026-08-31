import { Modules } from "@medusajs/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

jest.setTimeout(90 * 1000)

/**
 * Storefront design-assistant conversation store (chat design editor) —
 * utility cases.
 *
 * The conversation store is the server mirror of the design-chat threads:
 * stateless chat + verbatim UIMessage persistence, scoped by normalised maker
 * EMAIL (the flow's gate — public routes, no customer auth) + thread key.
 * Utility cases proven here:
 *   - verbatim message replay (create → read back)
 *   - title / messages defaults
 *   - light list shape (no heavy message bodies) + newest-first
 *   - thread-key isolation (same maker, different base-product scope)
 *   - PATCH persists messages + links the design (first generation)
 *   - cross-maker isolation (ids aren't probeable across emails)
 *   - DELETE
 *   - scope validation (missing email / thread key rejected)
 *   - pick API shape validation (design_id + canvas_id required)
 *
 * Mirrors the admin-assistant conversations spec (#1092) with the design
 * flow's email scoping.
 */

const MAKER_EMAIL = "maker@jyt.test"
const THREAD_KEY = "product:prod_test"

const SAMPLE_MESSAGES = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "Design an indigo kurta" }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      { type: "text", text: "Locked the brief — indigo kurta, earthy tones." },
    ],
  },
]

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Storefront design-assistant conversations API", () => {
    let storeHeaders: Record<string, any>

    const scopeQuery = `customer_email=${encodeURIComponent(MAKER_EMAIL)}&thread_key=${encodeURIComponent(THREAD_KEY)}`

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)

      // Publishable API key (required for /store/* routes) linked to the
      // default sales channel — mirror of design-production-story.spec.ts.
      const { result: apiKeys } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            {
              type: "publishable",
              title: "Design Assistant Test Key",
              created_by: "admin",
            },
          ],
        },
      })
      const pubKey = apiKeys[0]
      const storeService = container.resolve(Modules.STORE) as any
      const stores = await storeService.listStores({})
      if (stores?.[0]?.default_sales_channel_id) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: {
            id: pubKey.id,
            add: [stores[0].default_sales_channel_id],
          },
        })
      }
      storeHeaders = { headers: { "x-publishable-api-key": pubKey.token } }
    })

    it("creates a conversation and replays messages verbatim", async () => {
      const post = await api.post(
        "/store/custom/design-assistant/conversations",
        {
          customer_email: MAKER_EMAIL,
          thread_key: THREAD_KEY,
          title: "Indigo kurta",
          messages: SAMPLE_MESSAGES,
        },
        storeHeaders
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.customer_email).toBe(MAKER_EMAIL)
      expect(post.data.conversation.thread_key).toBe(THREAD_KEY)
      expect(post.data.conversation.title).toBe("Indigo kurta")
      expect(post.data.conversation.design_id).toBeNull()

      const get = await api.get(
        `/store/custom/design-assistant/conversations/${post.data.conversation.id}?${scopeQuery}`,
        storeHeaders
      )
      expect(get.status).toBe(200)
      expect(get.data.conversation.messages).toHaveLength(2)
      expect(get.data.conversation.messages[0].parts[0].text).toBe(
        "Design an indigo kurta"
      )
      expect(get.data.conversation.messages[1].role).toBe("assistant")
    })

    it("defaults the title and messages when omitted", async () => {
      const post = await api.post(
        "/store/custom/design-assistant/conversations",
        {
          customer_email: MAKER_EMAIL,
          thread_key: THREAD_KEY,
        },
        storeHeaders
      )
      expect(post.status).toBe(201)
      expect(post.data.conversation.title).toBe("New chat")
      expect(post.data.conversation.messages).toEqual([])
    })

    it("lists scoped conversations newest first, light shape (no bodies)", async () => {
      await api.post(
        "/store/custom/design-assistant/conversations",
        { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "First" },
        storeHeaders
      )
      // Small delay so updated_at ordering is unambiguous.
      await new Promise((r) => setTimeout(r, 20))
      await api.post(
        "/store/custom/design-assistant/conversations",
        { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "Second" },
        storeHeaders
      )

      const list = await api.get(
        `/store/custom/design-assistant/conversations?${scopeQuery}`,
        storeHeaders
      )
      expect(list.status).toBe(200)
      expect(list.data.count).toBe(2)
      expect(list.data.conversations[0].title).toBe("Second")
      expect(list.data.conversations[0].messages).toBeUndefined()
    })

    it("isolates threads by thread key (same maker, different scope)", async () => {
      await api.post(
        "/store/custom/design-assistant/conversations",
        { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "Kurta" },
        storeHeaders
      )
      await api.post(
        "/store/custom/design-assistant/conversations",
        {
          customer_email: MAKER_EMAIL,
          thread_key: "custom",
          title: "Standalone",
        },
        storeHeaders
      )

      const kurtaList = await api.get(
        `/store/custom/design-assistant/conversations?${scopeQuery}`,
        storeHeaders
      )
      expect(kurtaList.data.count).toBe(1)
      expect(kurtaList.data.conversations[0].title).toBe("Kurta")

      const customList = await api.get(
        `/store/custom/design-assistant/conversations?customer_email=${encodeURIComponent(MAKER_EMAIL)}&thread_key=custom`,
        storeHeaders
      )
      expect(customList.data.count).toBe(1)
      expect(customList.data.conversations[0].title).toBe("Standalone")
    })

    it("PATCH persists messages and links the design (first generation)", async () => {
      const post = await api.post(
        "/store/custom/design-assistant/conversations",
        { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "Draft" },
        storeHeaders
      )
      const id = post.data.conversation.id

      const res = await api.patch(
        `/store/custom/design-assistant/conversations/${id}`,
        {
          customer_email: MAKER_EMAIL,
          thread_key: THREAD_KEY,
          design_id: "01M16TESTDESIGNROW",
          messages: SAMPLE_MESSAGES,
        },
        storeHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.conversation.design_id).toBe("01M16TESTDESIGNROW")
      expect(res.data.conversation.messages).toHaveLength(2)

      const get = await api.get(
        `/store/custom/design-assistant/conversations/${id}?${scopeQuery}`,
        storeHeaders
      )
      expect(get.data.conversation.design_id).toBe("01M16TESTDESIGNROW")
    })

    it("404s a conversation for a different maker email (isolation)", async () => {
      const post = await api.post(
        "/store/custom/design-assistant/conversations",
        {
          customer_email: MAKER_EMAIL,
          thread_key: THREAD_KEY,
          title: "Private",
        },
        storeHeaders
      )
      const id = post.data.conversation.id

      const wrongEmail = `customer_email=${encodeURIComponent("other@jyt.test")}&thread_key=${encodeURIComponent(THREAD_KEY)}`
      const get = await api
        .get(
          `/store/custom/design-assistant/conversations/${id}?${wrongEmail}`,
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)

      const patch = await api
        .patch(
          `/store/custom/design-assistant/conversations/${id}`,
          {
            customer_email: "other@jyt.test",
            thread_key: THREAD_KEY,
            title: "Hijack",
          },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(patch.status).toBe(404)

      const del = await api
        .delete(`/store/custom/design-assistant/conversations/${id}`, {
          headers: {
            ...storeHeaders.headers,
            "Content-Type": "application/json",
          },
          data: { customer_email: "other@jyt.test", thread_key: THREAD_KEY },
        })
        .catch((e: any) => e.response)
      expect(del.status).toBe(404)

      // The real maker still reads it fine.
      const owner = await api.get(
        `/store/custom/design-assistant/conversations/${id}?${scopeQuery}`,
        storeHeaders
      )
      expect(owner.status).toBe(200)
    })

    it("deletes a conversation for the owning maker", async () => {
      const post = await api.post(
        "/store/custom/design-assistant/conversations",
        { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "Gone" },
        storeHeaders
      )
      const id = post.data.conversation.id

      const del = await api.delete(
        `/store/custom/design-assistant/conversations/${id}`,
        {
          headers: {
            ...storeHeaders.headers,
            "Content-Type": "application/json",
          },
          data: { customer_email: MAKER_EMAIL, thread_key: THREAD_KEY },
        }
      )
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      const get = await api
        .get(
          `/store/custom/design-assistant/conversations/${id}?${scopeQuery}`,
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)
    })

    it("rejects scope-less creates (missing email or thread key)", async () => {
      const noEmail = await api
        .post(
          "/store/custom/design-assistant/conversations",
          { thread_key: THREAD_KEY },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(noEmail.status).toBe(400)

      const noThread = await api
        .post(
          "/store/custom/design-assistant/conversations",
          { customer_email: MAKER_EMAIL },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(noThread.status).toBe(400)
    })

    it("pick API requires design_id and canvas_id", async () => {
      const missing = await api
        .post("/store/custom/design-assistant/pick", {}, storeHeaders)
        .catch((e: any) => e.response)
      expect([400, 404, 500].includes(missing.status)).toBe(true)
      expect(missing.status).not.toBe(200)
    })

    it("pick API surfaces a readable error for an unknown design", async () => {
      const res = await api
        .post(
          "/store/custom/design-assistant/pick",
          {
            design_id: "01M16UNKNOWNDESIGNROW",
            canvas_id: "cv-unknown",
          },
          storeHeaders
        )
        .catch((e: any) => e.response)
      // runSetActiveCanvas 404s unknown designs — surfaced as NOT_FOUND.
      expect([400, 404].includes(res.status)).toBe(true)
    })
  })
})
