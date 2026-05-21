/**
 * LLM extraction layer for /store/ai/search.
 *
 * Provider resolution order:
 *
 *   1. **DB-configured AI platform** for role `ai_search_chat` (admin
 *      configured one in Settings → External Platforms). When present,
 *      this is the ONLY provider we try — admins picked it deliberately,
 *      so silently switching to env-var providers on a model error
 *      would mask configuration problems.
 *
 *   2. **Env-var fallback chain** when no DB platform is configured.
 *      Tried in this order, first success wins:
 *        a. OpenRouter free models via the existing
 *           dynamicFreeTextModel resolver
 *        b. DashScope (Qwen) when DASHSCOPE_API_KEY is set
 *        c. Cloudflare Workers AI when CLOUDFLARE_AI_ACCOUNT_ID +
 *           CLOUDFLARE_AI_TOKEN are set
 *
 *   3. If everything fails (no providers, all rate-limited, schema
 *      mismatch) we fall back to treating the raw query as a single
 *      keyword so search still works — just without the LLM enrichment.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { createOpenAI } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import { dynamicFreeTextModel } from "../../../../mastra/providers/dynamic-text-model"
import {
  buildChatModel,
  getAiPlatformForRole,
} from "../../../../mastra/services/ai-platforms"

const SearchInterpretationSchema = z.object({
  keywords: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(8)
    .describe(
      "1-8 substantive search terms extracted from the query, excluding filler words"
    ),
  color: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Color if mentioned, single word"),
  material: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Fabric / material if mentioned (cotton, silk, linen, etc.)"),
  min_price: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Minimum price floor in major currency units"),
  max_price: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Maximum price ceiling in major currency units"),
})

export type SearchInterpretation = z.infer<typeof SearchInterpretationSchema>

const SYSTEM_PROMPT = `You convert a shopper's natural-language search for fashion / textile products into a small structured interpretation.

Rules:
- Extract 1-8 substantive keywords. Exclude filler verbs (find, show, want, looking, for, get, give, need), articles (the, a, an, some), and the word "product" itself.
- If a color is mentioned, return it as a single word.
- If a fabric or material is mentioned, return it as a single word (cotton, silk, linen, wool, etc.).
- If a price ceiling or floor is mentioned, extract it as an integer in major currency units. Ignore the currency symbol — just the number.
- Never fabricate fields. If something isn't in the query, omit it.`

// ── Provider builders (lazy) ───────────────────────────────────────────

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

// ── Provider chain ─────────────────────────────────────────────────────

type Attempt = { name: string; call: () => Promise<SearchInterpretation> }

const buildAttempts = (query: string): Attempt[] => {
  const opts = {
    schema: SearchInterpretationSchema,
    system: SYSTEM_PROMPT,
    prompt: query,
    temperature: 0.1,
  }
  const attempts: Attempt[] = []

  // 1. OpenRouter free models (via existing dynamic rotator)
  if (process.env.OPENROUTER_API_KEY) {
    attempts.push({
      name: "openrouter:free",
      call: async () => {
        const { object } = await generateObject({
          ...opts,
          model: dynamicFreeTextModel,
        })
        return object
      },
    })
  }

  // 2. DashScope (Qwen)
  const dashscope = getDashscope()
  if (dashscope) {
    const modelId =
      process.env.STOREFRONT_SEARCH_DASHSCOPE_MODEL || "qwen-turbo"
    attempts.push({
      name: `dashscope:${modelId}`,
      call: async () => {
        const { object } = await generateObject({
          ...opts,
          model: dashscope(modelId),
        })
        return object
      },
    })
  }

  // 3. Cloudflare Workers AI
  const cloudflare = getCloudflare()
  if (cloudflare) {
    const modelId =
      process.env.STOREFRONT_SEARCH_CLOUDFLARE_MODEL ||
      "@cf/meta/llama-3.1-8b-instruct"
    attempts.push({
      name: `cloudflare:${modelId}`,
      call: async () => {
        const { object } = await generateObject({
          ...opts,
          model: cloudflare(modelId),
        })
        return object
      },
    })
  }

  return attempts
}

/**
 * Convert a natural-language shopper query into a small structured
 * interpretation.
 *
 * If the admin has configured a platform for role `ai_search_chat`
 * we use that exclusively. Otherwise we walk the env-var fallback
 * chain (OpenRouter free → DashScope → Cloudflare). All-failures
 * degrade to a single-keyword interpretation so search still works.
 */
export const extractSearchInterpretation = async (
  query: string,
  container?: MedusaContainer
): Promise<SearchInterpretation> => {
  const opts = {
    schema: SearchInterpretationSchema,
    system: SYSTEM_PROMPT,
    prompt: query,
    temperature: 0.1,
  }

  // 1. DB-configured platform — wins if present.
  if (container) {
    try {
      const cfg = await getAiPlatformForRole(container, "ai_search_chat")
      if (cfg) {
        try {
          const { object } = await generateObject({
            ...opts,
            model: buildChatModel(cfg),
          })
          return object
        } catch (e: any) {
          console.warn(
            `[store/ai/search] db-platform ${cfg.platformId} (${cfg.providerType}) failed:`,
            e?.message ?? e
          )
          // Fall through to env chain — better degraded behaviour
          // than failing the search outright when one DB-configured
          // provider has a transient issue.
        }
      }
    } catch (e: any) {
      console.warn(
        "[store/ai/search] getAiPlatformForRole failed:",
        e?.message ?? e
      )
    }
  }

  // 2. Env-var chain (legacy / unconfigured deployments).
  const attempts = buildAttempts(query)
  for (const attempt of attempts) {
    try {
      return await attempt.call()
    } catch (e: any) {
      console.warn(
        `[store/ai/search] ${attempt.name} failed:`,
        e?.message ?? e
      )
    }
  }
  return { keywords: [query] }
}
