/**
 * Storefront chat agent — model + prompt resolver.
 *
 * The route (`apps/backend/src/api/store/ai/chat/route.ts`) calls
 * `resolveStorefrontChatModel(container)` to get a LanguageModel, then
 * `buildStorefrontChatSystem(prefs)` to get the system prompt, then
 * pipes both into AI-SDK `streamText({ tools })` so the response streams
 * token-by-token back to the client.
 *
 * Provider resolution mirrors `extract.ts`:
 *   1. DB-configured platform for role `ai_search_chat` (admin picks)
 *   2. DashScope (Qwen) — needs DASHSCOPE_API_KEY
 *   3. Cloudflare Workers AI — needs CLOUDFLARE_AI_* pair
 *   4. OpenRouter free — last resort; free models often refuse tool calls
 *
 * We *don't* keep a Mastra `Agent` instance here because the agent needs
 * to be parameterised per-request: each visitor's prefs go into the
 * system prompt, and the search tool needs the container scope. Building
 * the parts the route assembles is cleaner than a singleton with mutable
 * config.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { createOpenAI } from "@ai-sdk/openai"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { dynamicFreeTextModel } from "../providers/dynamic-text-model"
import { buildChatModel, getAiPlatformForRole } from "../services/ai-platforms"

// ── Brand knowledge corpus ─────────────────────────────────────────────

const BRAND_KNOWLEDGE_PATH = join(__dirname, "..", "data", "storefront-brand-knowledge.md")

let _brandCache: string | null = null
const getBrandKnowledge = (): string => {
  if (_brandCache !== null) return _brandCache
  try {
    _brandCache = readFileSync(BRAND_KNOWLEDGE_PATH, "utf-8")
  } catch (e) {
    console.warn(
      "[storefront-chat] brand knowledge corpus missing — falling back to thin defaults:",
      (e as any)?.message ?? e
    )
    _brandCache = "Cici Label is a slow-fashion brand under Jaal Yantra Textiles."
  }
  return _brandCache
}

// ── System prompt ──────────────────────────────────────────────────────

export type UserPrefs = {
  colors?: string[]
  styles?: string[]
  materials?: string[]
  price_range?: { min?: number; max?: number }
  body?: { size?: string; fit?: "relaxed" | "fitted" }
  notes?: string
}

const formatPrefs = (prefs?: UserPrefs): string => {
  if (!prefs) return "(no preferences captured yet — feel free to ask one short question to learn what they like)"
  const lines: string[] = []
  if (prefs.colors?.length) lines.push(`- colors: ${prefs.colors.join(", ")}`)
  if (prefs.styles?.length) lines.push(`- styles: ${prefs.styles.join(", ")}`)
  if (prefs.materials?.length) lines.push(`- materials: ${prefs.materials.join(", ")}`)
  if (prefs.price_range?.min || prefs.price_range?.max) {
    const min = prefs.price_range.min ?? ""
    const max = prefs.price_range.max ?? ""
    lines.push(`- price range: ${min}–${max}`)
  }
  if (prefs.body?.size) lines.push(`- size: ${prefs.body.size}`)
  if (prefs.body?.fit) lines.push(`- fit preference: ${prefs.body.fit}`)
  if (prefs.notes) lines.push(`- notes: ${prefs.notes}`)
  return lines.length ? lines.join("\n") : "(captured, but empty)"
}

export const buildStorefrontChatSystem = (prefs?: UserPrefs): string => {
  return `You are a warm, concise concierge for Cici Label — a slow-fashion brand under Jaal Yantra Textiles (JYT). You help shoppers find pieces they'll love and answer questions about the brand.

# How to behave
- Two short paragraphs is plenty. Match the shopper's energy.
- You have catalogue tools — use the right one and don't fabricate products, categories, or prices:
  - search_products — the shopper describes what they want ("soft indigo cotton kurta").
  - get_categories — the shopper asks what you sell or how the catalogue is organised. Summarise the categories in prose (no cards render for this one).
  - get_category_products — the shopper wants to browse a named category ("show me your sarees").
  - get_product_details — the shopper asks about one specific item (use its handle from a previous result).
- Before a tool call, briefly say what you're doing ("Looking for indigo handwoven cottons…") so the wait feels intentional.
- After product results come back, write a one or two sentence summary in prose ("I found a few cotton handwoven pieces — the ivory kurta and the indigo set both look like what you described."). The UI renders the product cards below your text, so don't list them by hand.
- After showing product results the shopper seems interested in, ask for their name and email so we can follow up about those pieces. Phrase it naturally: "By the way, could I grab your name and email? I can follow up about these pieces if you'd like." Only ask once per conversation — don't repeat the question if they've already provided it.
- For brand questions (custom design, sizing, materials, partners, shipping), answer from the BRAND KNOWLEDGE below. If something isn't covered, say so and point to hello@cicilabel.com.
- For custom design: route the shopper to /design — that's the self-service editor. Don't fabricate a custom-design intake form.
- Never give prices or stock numbers unless they come from the search_products tool.
- Don't push a sale. The shopper asks; you suggest.

# Customer preferences (from onboarding)
${formatPrefs(prefs)}

If the customer's preferences contain colors / materials / price range, weave them into your search_products call. If preferences are empty, it's fine to ask one quick question to narrow the search — but don't run a long onboarding interrogation; one question at a time.

# Brand knowledge

${getBrandKnowledge()}`
}

// ── Model resolution ───────────────────────────────────────────────────

let _dashscope: ReturnType<typeof createOpenAI> | null = null
const getDashscope = () => {
  if (_dashscope) return _dashscope
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) return null
  _dashscope = createOpenAI({
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey,
  })
  return _dashscope
}

let _cloudflare: ReturnType<typeof createOpenAI> | null = null
const getCloudflare = () => {
  if (_cloudflare) return _cloudflare
  const accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_AI_TOKEN
  if (!accountId || !token) return null
  _cloudflare = createOpenAI({
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    apiKey: token,
  })
  return _cloudflare
}

export type ResolvedChatModel = {
  /** AI-SDK LanguageModel to pass into streamText({ model }) */
  model: any
  /** For logs / debugging — which provider we picked. */
  provider: string
}

/**
 * Resolve the chat model for this request. DB-configured platform wins
 * if present; otherwise walk the env-var fallback chain. Returns null
 * when no provider is available — the route should respond with a 503
 * rather than throwing into the AI SDK.
 */
export const resolveStorefrontChatModel = async (
  container: MedusaContainer
): Promise<ResolvedChatModel | null> => {
  // 1. Admin-configured platform.
  try {
    const cfg = await getAiPlatformForRole(container, "ai_search_chat")
    if (cfg) {
      return {
        model: buildChatModel(cfg),
        provider: `db:${cfg.providerType}:${cfg.platformId}`,
      }
    }
  } catch (e: any) {
    console.warn(
      "[storefront-chat] getAiPlatformForRole failed, falling through to env:",
      e?.message ?? e
    )
  }

  // 2. DashScope (Qwen) — best free-tier tool-use story.
  const dashscope = getDashscope()
  if (dashscope) {
    const modelId =
      process.env.STOREFRONT_CHAT_DASHSCOPE_MODEL || "qwen-plus"
    return { model: dashscope(modelId), provider: `dashscope:${modelId}` }
  }

  // 3. Cloudflare Workers AI.
  const cloudflare = getCloudflare()
  if (cloudflare) {
    const modelId =
      process.env.STOREFRONT_CHAT_CLOUDFLARE_MODEL ||
      "@cf/meta/llama-3.1-8b-instruct"
    return { model: cloudflare(modelId), provider: `cloudflare:${modelId}` }
  }

  // 4. OpenRouter free (tool use is hit-or-miss — last resort).
  if (process.env.OPENROUTER_API_KEY) {
    return { model: dynamicFreeTextModel, provider: "openrouter:free" }
  }

  return null
}
