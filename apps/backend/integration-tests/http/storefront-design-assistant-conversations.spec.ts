import { Modules } from "@medusajs/utils"
import jwt from "jsonwebtoken"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  runCreateDesign,
  runEnsureGuestCustomer,
} from "../../src/mastra/agents/tools/storefront-design-flow"

jest.setTimeout(90 * 1000)

/**
 * Storefront design-assistant conversation store (chat design editor).
 *
 * The conversation store is the server mirror of the design-chat threads:
 * stateless chat + verbatim UIMessage persistence.
 *
 * 🔴 #2543: threads used to be scoped by the maker's EMAIL and nothing else,
 * so anyone who knew an email could list, read, rewrite and delete that
 * maker's transcripts. Access is now
 *   - the conversation token minted on create (`x-conversation-token`), or
 *   - a signed-in customer whose email is the thread's.
 * An email alone reads nothing. Proven here, alongside the utility cases
 * (verbatim replay, defaults, list shape, thread-key isolation, PATCH, DELETE,
 * scope validation) and the pick route's token gate.
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
    let pubKeyToken: string

    /** Headers for a guest holding a conversation token. */
    const withConversation = (token: string) => ({
      headers: { ...storeHeaders.headers, "x-conversation-token": token },
    })

    /** Headers for a signed-in customer (bearer, as the storefront forwards it). */
    const asCustomer = async (email: string) => {
      const { customer_id } = await runEnsureGuestCustomer(getContainer(), email)
      const token = jwt.sign(
        { actor_id: customer_id, actor_type: "customer", auth_identity_id: "authid_test_2543" },
        process.env.JWT_SECRET || "supersecret",
        { expiresIn: "1h" }
      )
      return {
        customer_id,
        headers: {
          "x-publishable-api-key": pubKeyToken,
          authorization: `Bearer ${token}`,
        },
      }
    }

    const create = (data: Record<string, any>, config = storeHeaders) =>
      api.post("/store/custom/design-assistant/conversations", data, config)

    const uniqueEmail = (tag: string) =>
      `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@jyt.test`

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      await getAuthHeaders(api)

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
      pubKeyToken = pubKey.token
      storeHeaders = { headers: { "x-publishable-api-key": pubKey.token } }
    })

    it("creates a conversation, returns its token, and replays messages verbatim", async () => {
      const post = await create({
        customer_email: MAKER_EMAIL,
        thread_key: THREAD_KEY,
        title: "Indigo kurta",
        messages: SAMPLE_MESSAGES,
      })
      expect(post.status).toBe(201)
      expect(post.data.conversation.customer_email).toBe(MAKER_EMAIL)
      expect(post.data.conversation.thread_key).toBe(THREAD_KEY)
      expect(post.data.conversation.title).toBe("Indigo kurta")
      expect(post.data.conversation.design_id).toBeNull()
      expect(typeof post.data.conversation_token).toBe("string")

      const get = await api.get(
        `/store/custom/design-assistant/conversations/${post.data.conversation.id}`,
        withConversation(post.data.conversation_token)
      )
      expect(get.status).toBe(200)
      expect(get.data.conversation.messages).toHaveLength(2)
      expect(get.data.conversation.messages[0].parts[0].text).toBe(
        "Design an indigo kurta"
      )
      expect(get.data.conversation.messages[1].role).toBe("assistant")
    })

    it("defaults the title and messages when omitted", async () => {
      const post = await create({ customer_email: MAKER_EMAIL, thread_key: THREAD_KEY })
      expect(post.status).toBe(201)
      expect(post.data.conversation.title).toBe("New chat")
      expect(post.data.conversation.messages).toEqual([])
    })

    it("🔴 an email alone reads nothing — list, single read, patch, delete", async () => {
      const email = uniqueEmail("victim")
      const post = await create({
        customer_email: email,
        thread_key: THREAD_KEY,
        title: "Private",
        messages: SAMPLE_MESSAGES,
      })
      const id = post.data.conversation.id
      const scope = `customer_email=${encodeURIComponent(email)}&thread_key=${encodeURIComponent(THREAD_KEY)}`

      // The old public list: email + thread key. Now empty for a guest.
      const list = await api.get(
        `/store/custom/design-assistant/conversations?${scope}`,
        storeHeaders
      )
      expect(list.status).toBe(200)
      expect(list.data.count).toBe(0)

      const get = await api
        .get(`/store/custom/design-assistant/conversations/${id}?${scope}`, storeHeaders)
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)

      const patch = await api
        .patch(
          `/store/custom/design-assistant/conversations/${id}`,
          { customer_email: email, thread_key: THREAD_KEY, title: "Hijack" },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(patch.status).toBe(404)

      const del = await api
        .delete(`/store/custom/design-assistant/conversations/${id}`, {
          headers: { ...storeHeaders.headers, "Content-Type": "application/json" },
          data: { customer_email: email, thread_key: THREAD_KEY },
        })
        .catch((e: any) => e.response)
      expect(del.status).toBe(404)

      // Another conversation's token does not open this one.
      const other = await create({ customer_email: uniqueEmail("other"), thread_key: THREAD_KEY })
      const crossed = await api
        .get(
          `/store/custom/design-assistant/conversations/${id}`,
          withConversation(other.data.conversation_token)
        )
        .catch((e: any) => e.response)
      expect(crossed.status).toBe(404)

      // The holder of the real token still reads it, untouched.
      const owner = await api.get(
        `/store/custom/design-assistant/conversations/${id}`,
        withConversation(post.data.conversation_token)
      )
      expect(owner.status).toBe(200)
      expect(owner.data.conversation.title).toBe("Private")
    })

    it("a signed-in customer lists only their own threads, newest first, with tokens", async () => {
      const email = uniqueEmail("signed")
      const me = await asCustomer(email)

      await create({ customer_email: email, thread_key: THREAD_KEY, title: "First" })
      await new Promise((r) => setTimeout(r, 20))
      await create({ customer_email: email, thread_key: THREAD_KEY, title: "Second" })
      await create({ customer_email: email, thread_key: "custom", title: "Standalone" })
      await create({ customer_email: uniqueEmail("stranger"), thread_key: THREAD_KEY, title: "Not mine" })

      const list = await api.get(
        `/store/custom/design-assistant/conversations?thread_key=${encodeURIComponent(THREAD_KEY)}`,
        { headers: me.headers }
      )
      expect(list.status).toBe(200)
      expect(list.data.count).toBe(2)
      expect(list.data.conversations.map((c: any) => c.title)).toEqual(["Second", "First"])
      expect(list.data.conversations[0].messages).toBeUndefined()
      expect(typeof list.data.conversations[0].conversation_token).toBe("string")

      // Thread-key isolation.
      const custom = await api.get(
        `/store/custom/design-assistant/conversations?thread_key=custom`,
        { headers: me.headers }
      )
      expect(custom.data.count).toBe(1)
      expect(custom.data.conversations[0].title).toBe("Standalone")

      // A list token opens the thread.
      const get = await api.get(
        `/store/custom/design-assistant/conversations/${list.data.conversations[0].id}`,
        withConversation(list.data.conversations[0].conversation_token)
      )
      expect(get.status).toBe(200)
    })

    it("PATCH links a design only with that design's token", async () => {
      const email = uniqueEmail("linker")
      const design = await runCreateDesign(
        getContainer(),
        {
          email,
          name: "Indigo Kurta",
          brief: {
            product_type: "kurta",
            concept_theme: "Indigo",
            aesthetic_keywords: ["handwoven"],
            color_palette: [{ name: "indigo", code: "#1e3a5f" }],
          },
        },
        { email } as any
      )
      const post = await create({ customer_email: email, thread_key: THREAD_KEY, title: "Draft" })
      const id = post.data.conversation.id
      const convHeaders = withConversation(post.data.conversation_token)

      const denied = await api
        .patch(
          `/store/custom/design-assistant/conversations/${id}`,
          { design_id: design.design_id },
          convHeaders
        )
        .catch((e: any) => e.response)
      expect(denied.status).toBe(403)

      const res = await api.patch(
        `/store/custom/design-assistant/conversations/${id}`,
        { design_id: design.design_id, messages: SAMPLE_MESSAGES },
        {
          headers: { ...convHeaders.headers, "x-design-token": design.design_token },
        }
      )
      expect(res.status).toBe(200)
      expect(res.data.conversation.design_id).toBe(design.design_id)
      expect(res.data.conversation.messages).toHaveLength(2)
    })

    it("deletes a conversation for the token holder", async () => {
      const post = await create({ customer_email: MAKER_EMAIL, thread_key: THREAD_KEY, title: "Gone" })
      const id = post.data.conversation.id
      const headers = withConversation(post.data.conversation_token)

      const del = await api.delete(`/store/custom/design-assistant/conversations/${id}`, {
        headers: { ...headers.headers, "Content-Type": "application/json" },
        data: {},
      })
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      const get = await api
        .get(`/store/custom/design-assistant/conversations/${id}`, headers)
        .catch((e: any) => e.response)
      expect(get.status).toBe(404)
    })

    it("rejects scope-less creates (missing email or thread key)", async () => {
      const noEmail = await create({ thread_key: THREAD_KEY }).catch((e: any) => e.response)
      expect(noEmail.status).toBe(400)

      const noThread = await create({ customer_email: MAKER_EMAIL }).catch(
        (e: any) => e.response
      )
      expect(noThread.status).toBe(400)
    })

    it("pick API validates its body", async () => {
      const missing = await api
        .post("/store/custom/design-assistant/pick", {}, storeHeaders)
        .catch((e: any) => e.response)
      expect(missing.status).toBe(400)
    })

    it("🔴 pick API refuses without the design's token — even for an unknown id", async () => {
      // Same 403 whether or not the design exists: no existence oracle.
      const unknown = await api
        .post(
          "/store/custom/design-assistant/pick",
          { design_id: "01M16UNKNOWNDESIGNROW", canvas_id: "cv-unknown" },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(unknown.status).toBe(403)

      const email = uniqueEmail("picker")
      const design = await runCreateDesign(
        getContainer(),
        {
          email,
          name: "Pick Kurta",
          brief: {
            product_type: "kurta",
            concept_theme: "Pick",
            aesthetic_keywords: ["plain"],
            color_palette: [{ name: "ecru", code: "#e8e0cf" }],
          },
        },
        { email } as any
      )
      const real = await api
        .post(
          "/store/custom/design-assistant/pick",
          { design_id: design.design_id, canvas_id: "cv-unknown" },
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(real.status).toBe(403)

      // With the token the request gets past the gate (the canvas is not on
      // the board, so the pick itself 404s).
      const withToken = await api
        .post(
          "/store/custom/design-assistant/pick",
          { design_id: design.design_id, canvas_id: "cv-unknown" },
          { headers: { ...storeHeaders.headers, "x-design-token": design.design_token } }
        )
        .catch((e: any) => e.response)
      expect(withToken.status).toBe(404)
    })

    it("🔴 board read needs the design's token (email query no longer works)", async () => {
      const email = uniqueEmail("board")
      const design = await runCreateDesign(
        getContainer(),
        {
          email,
          name: "Board Kurta",
          brief: {
            product_type: "kurta",
            concept_theme: "Board",
            aesthetic_keywords: ["plain"],
            color_palette: [{ name: "ecru", code: "#e8e0cf" }],
          },
        },
        { email } as any
      )
      const byEmail = await api
        .get(
          `/store/custom/design-assistant/designs/${design.design_id}?customer_email=${encodeURIComponent(email)}`,
          storeHeaders
        )
        .catch((e: any) => e.response)
      expect(byEmail.status).toBe(403)

      const ok = await api.get(`/store/custom/design-assistant/designs/${design.design_id}`, {
        headers: { ...storeHeaders.headers, "x-design-token": design.design_token },
      })
      expect(ok.status).toBe(200)
      expect(ok.data.design.id).toBe(design.design_id)

      // The signed-in owner reads it without a token.
      const owner = await asCustomer(email)
      const asOwner = await api.get(
        `/store/custom/design-assistant/designs/${design.design_id}`,
        { headers: owner.headers }
      )
      expect(asOwner.status).toBe(200)
    })
  })
})
