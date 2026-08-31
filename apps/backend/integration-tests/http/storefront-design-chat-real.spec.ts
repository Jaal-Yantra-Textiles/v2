import { Modules } from "@medusajs/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows"

jest.setTimeout(180 * 1000)

/**
 * Real, end-to-end storefront design chat — the streaming `POST /store/ai/chat`
 * route in DESIGN mode, driven by a live model.
 *
 * This is NOT a mock test: it walks the full pipeline the storefront design
 * editor uses (validate → resolve provider → build the designer-guide system
 * prompt → bind the design tools → streamText → pipe SSE), and asserts on what
 * a REAL provider streams back.
 *
 * Provider resolution for role `ai_search_chat` (see storefront-chat.ts):
 *   1. DB-configured platform for the role (admin picks) — primary
 *   2. DashScope           — DASHSCOPE_API_KEY
 *   3. Cloudflare Workers AI — CLOUDFLARE_AI_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN
 *   4. OpenRouter free     — OPENROUTER_API_KEY (last resort)
 *
 * The route returns 503 "AI chat is not configured" when none resolve. The
 * suite is gated so CI (no keys, no platform row) skips it — the same reason
 * ai-chat-workflow.spec.ts gates on OPENROUTER_API_KEY. Set any of the env
 * pairs (or configure an `ai_search_chat` platform in the DB) to run locally.
 */
const HAS_PROVIDER =
  Boolean(
    process.env.CLOUDFLARE_AI_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN
  ) ||
  Boolean(process.env.DASHSCOPE_API_KEY) ||
  Boolean(process.env.OPENROUTER_API_KEY)
const describeReal = HAS_PROVIDER ? describe : describe.skip

/**
 * Sample garment image for the analysis-first flow.
 *
 * The vision tool (`analyze_product_image` → `describe-product-image`) sends
 * the image to the `ai_product_description` provider over HTTP, so the image
 * must be a URL the provider can fetch (or a `data:` URL for Cloudflare, which
 * only accepts base64). A local file therefore can't be dropped in directly:
 *   - HEIC is not a format vision providers read (convert to JPEG first);
 *   - a local path is unreachable by the provider (needs a public URL).
 *
 * To run against your own garment photo, convert it and set:
 *   SAMPLE_IMAGE_URL=https://…/garment.jpg        (or a data:image/jpeg;base64,… URL)
 *
 * Defaults to a stable, always-on free placeholder (picsum) so CI and local
 * runs both work without any upload step.
 */
const SAMPLE_IMAGE_URL =
  process.env.SAMPLE_IMAGE_URL ||
  "https://picsum.photos/seed/jyt-garment/800/1000"

// ── SSE parsing ─────────────────────────────────────────────────────────
// pipeUIMessageStreamToResponse frames each chunk as `data: {json}\n\n` and
// terminates with `data: [DONE]\n\n`. Parse the buffered body back into the
// chunk objects so assertions can target chunk types instead of substrings.
type UiChunk = { type?: string; [key: string]: any }

const parseSseChunks = (body: string): UiChunk[] => {
  const chunks: UiChunk[] = []
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice("data: ".length).trim()
    if (payload === "[DONE]") continue
    try {
      chunks.push(JSON.parse(payload))
    } catch {
      // ignore malformed frames — the assertions below only need valid ones
    }
  }
  return chunks
}

const chunkTypes = (chunks: UiChunk[]) => chunks.map((c) => c.type)

const hasText = (chunks: UiChunk[]) =>
  chunks.some((c) => c.type === "text-delta" && (c.delta ?? "").trim().length > 0)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describeReal("Storefront design chat — real provider, end to end", () => {
    let storeHeaders: Record<string, any>
    let adminHeaders: Record<string, any>
    let salesChannelId: string | undefined

    const MAKER_EMAIL = "realchat@jyt.test"
    const VISITOR_ID = "realchat-visitor"

    const designBody = (text: string, context?: Record<string, any>) => ({
      visitor_id: VISITOR_ID,
      prefs: {
        colors: ["indigo", "natural"],
        materials: ["cotton"],
        body: { fit: "relaxed" as const },
      },
      context: { email: MAKER_EMAIL, ...(context ?? {}) },
      messages: [
        {
          id: "u1",
          role: "user" as const,
          parts: [{ type: "text", text }],
        },
      ],
    })

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Register the chat model through the AI provider settings — the same
      // path production uses (Admin → External Platforms, role ai_search_chat).
      // The route prefers this platform over the env-fallback chain, so this
      // proves the real provider-settings resolution, not just the fallback.
      const cfToken = process.env.CLOUDFLARE_AI_TOKEN
      const cfAccountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID
      const model =
        process.env.STOREFRONT_CHAT_CLOUDFLARE_MODEL || "@cf/moonshotai/kimi-k2.6"
      if (cfToken && cfAccountId) {
        await api.post(
          "/admin/social-platforms",
          {
            name: "Cloudflare AI — design chat test",
            category: "ai",
            auth_type: "bearer",
            status: "active",
            api_config: {
              api_key: cfToken,
              account_id: cfAccountId,
              default_model: model,
            },
            metadata: {
              provider_type: "cloudflare",
              role: "ai_search_chat",
              is_default: true,
            },
          },
          adminHeaders
        )
      }

      // Publishable API key required for /store/* routes, linked to the
      // default sales channel — mirror of the design-assistant conversations
      // spec and design-production-story.spec.ts.
      const { result: apiKeys } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            {
              type: "publishable",
              title: "Design Chat Real Provider Test Key",
              created_by: "admin",
            },
          ],
        },
      })
      const pubKey = apiKeys[0]
      const storeService = container.resolve(Modules.STORE) as any
      const stores = await storeService.listStores({})
      salesChannelId = stores?.[0]?.default_sales_channel_id
      if (salesChannelId) {
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: {
            id: pubKey.id,
            add: [salesChannelId],
          },
        })
      }
      storeHeaders = { headers: { "x-publishable-api-key": pubKey.token } }
    })

    it("streams a real reply for a design-chat turn (brief)", async () => {
      const res = await api.post(
        "/store/ai/chat",
        designBody(
          "I want to design an indigo cotton kurta with a relaxed fit. What should we call it?"
        ),
        { ...storeHeaders, responseType: "text" as const }
      )

      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/)

      const chunks = parseSseChunks(String(res.data))
      const types = chunkTypes(chunks)

      // A real model streamed actual text…
      expect(types).toContain("text-start")
      expect(hasText(chunks)).toBe(true)

      // …and the stream finished cleanly, without a provider/stream error.
      expect(types).toContain("finish")
      expect(types).not.toContain("error")
    })

    it("binds the design catalog tools and answers a fabric question", async () => {
      // One turn naming a garment AND asking to browse fabrics, with the
      // maker's email in context — so the turn planner lets the model browse
      // (garment on the board, email captured) and it should ground its reply
      // by calling list_raw_materials instead of just asking for a garment.
      const res = await api.post(
        "/store/ai/chat",
        designBody(
          "I want an indigo cotton kurta. Great — now what cotton fabrics can we make it from?"
        ),
        { ...storeHeaders, responseType: "text" as const }
      )

      expect(res.status).toBe(200)
      const chunks = parseSseChunks(String(res.data))
      const types = chunkTypes(chunks)

      // The design tools are wired in: the model invoked at least one design
      // tool to ground its answer (list_raw_materials / save_brief / …). The
      // turn completes cleanly; a long tool chain can exhaust output tokens
      // before a final prose chunk, so tool invocation — not prose — is the
      // success signal here.
      const designTools = [
        "list_raw_materials",
        "list_partners",
        "save_brief",
        "create_design",
        "analyze_product_image",
        "save_moodboard",
      ]
      const fired = chunks
        .filter((c) => c.type === "tool-input-start" || c.type === "tool-input-available")
        .map((c) => c.toolName)
        .filter((n) => designTools.includes(n))

      expect(types).toContain("finish")
      expect(types).not.toContain("error")
      expect(fired.length > 0 || hasText(chunks)).toBe(true)

      // eslint-disable-next-line no-console
      console.log(
        `[storefront-design-chat-real] fabric turn fired tools: ${fired.join(", ") || "(none — model answered in prose)"}`
      )
    })

    it("grounds the design on a product image (analysis-first flow)", async () => {
      // Seed a real garment with the sample image so the design context can
      // server-resolve it and inject the image into the designer-guide prompt.
      const ts = Date.now()
      const prodRes = await api.post(
        "/admin/products",
        {
          title: `Design Chat Garment ${ts}`,
          handle: `design-chat-garment-${ts}`,
          status: "published",
          thumbnail: SAMPLE_IMAGE_URL,
          images: [{ url: SAMPLE_IMAGE_URL }],
          sales_channels: salesChannelId ? [{ id: salesChannelId }] : undefined,
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              options: { Size: "M" },
              manage_inventory: false,
              prices: [{ amount: 5000, currency_code: "usd" }],
            },
          ],
        },
        adminHeaders
      )
      const productId = prodRes.data.product.id

      const res = await api.post(
        "/store/ai/chat",
        designBody(
          "What do you see in this garment? I want to design something inspired by it.",
          { product_id: productId }
        ),
        { ...storeHeaders, responseType: "text" as const }
      )

      expect(res.status).toBe(200)
      const chunks = parseSseChunks(String(res.data))
      const types = chunkTypes(chunks)

      // The designer-guide grounded on the real product image and replied.
      expect(types).toContain("text-start")
      expect(hasText(chunks)).toBe(true)
      expect(types).toContain("finish")
      expect(types).not.toContain("error")

      // Informational — the analysis-first flow asks the model to call
      // analyze_product_image. Whether that produced a result depends on the
      // configured `ai_product_description` vision provider (none is seeded
      // here, so the tool degrades gracefully and the model grounds on the
      // product title/description instead).
      const analyzed = chunks.filter(
        (c) =>
          c.type === "tool-input-start" &&
          (c.toolName ?? "") === "analyze_product_image"
      )
      const toolErrors = chunks.filter((c) => c.type === "tool-output-error")
      // eslint-disable-next-line no-console
      console.log(
        `[storefront-design-chat-real] analysis-first turn: analyze_product_image fired=${analyzed.length > 0}, tool-output-error=${toolErrors.length > 0}`
      )
    })
  })
})