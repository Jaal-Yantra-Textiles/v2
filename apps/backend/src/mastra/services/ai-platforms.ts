/**
 * AI platform resolution.
 *
 * Looks up an AI provider configured via the admin
 * "External Platforms" UI (Settings → External Platforms with
 * category="ai") and returns a normalised config the callers
 * (`extract.ts`, `productCatalog.ts`, …) can feed into the AI SDK.
 *
 * Provider abstraction:
 *   - `provider_type` (on platform.metadata) selects which AI SDK
 *     adapter to use. We support five today:
 *
 *       openrouter         — uses @openrouter/ai-sdk-provider
 *       dashscope          — OpenAI-compatible, base
 *                            dashscope-intl.aliyuncs.com/compatible-mode/v1
 *       cloudflare         — OpenAI-compatible, base
 *                            api.cloudflare.com/client/v4/accounts/<id>/ai/v1
 *       vercel_ai_gateway  — OpenAI-compatible Vercel AI Gateway endpoint
 *       custom             — any OpenAI-compatible endpoint with
 *                            api_config.base_url required
 *
 * Role assignment:
 *   - Each "role" (ai_search_chat, ai_search_embed,
 *     ai_product_description, …) has at most one default platform.
 *   - Selection: platform with `metadata.role === role` AND
 *     `metadata.is_default === true` AND `status === "active"`.
 *   - If multiple platforms match, the most-recently-updated wins
 *     (defensive — a uniqueness check should land at the write side).
 *
 * Fallback strategy:
 *   - This helper resolves DB-backed config only. If no platform is
 *     configured for a role, returns null and the caller falls back
 *     to environment variables. That keeps existing deployments
 *     working without any UI configuration.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { SOCIALS_MODULE } from "../../modules/socials"
import type SocialsService from "../../modules/socials/service"
import { decryptApiKey } from "../../modules/socials/utils/token-helpers"

export type AiProviderType =
  | "openrouter"
  | "dashscope"
  | "cloudflare"
  | "vercel_ai_gateway"
  | "fal"
  | "custom"

export type AiRole =
  | "ai_search_chat"
  | "ai_search_embed"
  | "ai_product_description"
  | "ai_image_gen"
  // Weekly partner-storefront digest AI summary (#589 item 4). Resolves the
  // digest summary provider from the admin-configured External Platform
  // instead of the hardcoded OPENROUTER_API_KEY env var.
  | "ai_digest_summary"
  // String escape hatch so callers can use ad-hoc roles without
  // bumping this union every time.
  | (string & {})

export type AiPlatformConfig = {
  platformId: string
  providerType: AiProviderType
  apiKey: string
  baseUrl: string
  /** Default model id stored on the platform — null if the admin
   * didn't set one (the caller picks their own default). */
  defaultModel: string | null
  /** Only set for provider_type=cloudflare. */
  accountId?: string
}

const PROVIDER_DEFAULTS: Record<
  AiProviderType,
  { baseUrl?: string; defaultModelHint?: string }
> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModelHint: "meta-llama/llama-3.3-70b-instruct:free",
  },
  dashscope: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModelHint: "qwen-turbo",
  },
  cloudflare: {
    // Filled in dynamically with the account id when read.
    defaultModelHint: "@cf/meta/llama-3.1-8b-instruct",
  },
  vercel_ai_gateway: {
    baseUrl: "https://gateway.ai.cloudflare.com/v1", // overridable; admin
    // can set api_config.base_url for the actual endpoint.
  },
  fal: {
    // FAL has its own SDK — not OpenAI-compatible. The helper here is
    // only used to surface the API key; callers use the @fal-ai/client
    // SDK directly with `fal.config({ credentials })`.
    defaultModelHint: "fal-ai/flux/schnell",
  },
  custom: {},
}

const normalizeProviderType = (raw: unknown): AiProviderType | null => {
  const s = String(raw ?? "").trim().toLowerCase()
  switch (s) {
    case "openrouter":
      return "openrouter"
    case "dashscope":
    case "qwen":
      return "dashscope"
    case "cloudflare":
    case "cf":
    case "workers_ai":
    case "workers-ai":
      return "cloudflare"
    case "vercel":
    case "vercel_ai":
    case "vercel_ai_gateway":
    case "vercel-ai-gateway":
      return "vercel_ai_gateway"
    case "fal":
    case "fal_ai":
    case "fal-ai":
      return "fal"
    case "custom":
    case "openai_compatible":
    case "openai-compatible":
      return "custom"
    default:
      return null
  }
}

/**
 * Resolve an AI platform from the DB for the given role. Returns null
 * if nothing is configured — caller falls back to env vars.
 */
export const getAiPlatformForRole = async (
  container: MedusaContainer,
  role: AiRole
): Promise<AiPlatformConfig | null> => {
  let socials: SocialsService
  try {
    socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  } catch {
    return null
  }

  let platforms: any[] = []
  try {
    platforms = await socials.listSocialPlatforms(
      {
        category: "ai",
        status: "active",
        // Filter narrows on the metadata.role tag the admin set. We
        // can't easily filter `metadata.is_default` in the DAL, so we
        // do that JS-side after the fetch.
        metadata: { role },
      } as any,
      { take: 10 }
    )
  } catch (e) {
    console.warn(
      "[ai-platforms] listSocialPlatforms failed:",
      (e as any)?.message ?? e
    )
    return null
  }

  // Pick the one explicitly marked as default for this role; if no
  // explicit default, pick the most recently updated of the candidates.
  const candidates = (platforms ?? []).filter(
    (p) => p?.metadata?.is_default === true
  )
  const chosen = candidates[0] ?? platforms[0]
  if (!chosen) return null

  const apiConfig = (chosen.api_config ?? {}) as Record<string, any>
  const meta = (chosen.metadata ?? {}) as Record<string, any>

  const providerType = normalizeProviderType(
    meta.provider_type ?? apiConfig.provider_type
  )
  if (!providerType) {
    console.warn(
      `[ai-platforms] platform ${chosen.id} has no recognised provider_type`
    )
    return null
  }

  const apiKey = decryptApiKey(apiConfig, container)
  if (!apiKey) {
    console.warn(
      `[ai-platforms] platform ${chosen.id} is missing api_key — skipping`
    )
    return null
  }

  // Resolve baseUrl in order of priority:
  //   1. api_config.base_url (admin override)
  //   2. platform.base_url (column)
  //   3. provider default
  const accountId =
    apiConfig.account_id ?? meta.account_id ?? undefined
  let baseUrl: string | undefined =
    apiConfig.base_url ?? chosen.base_url ?? PROVIDER_DEFAULTS[providerType].baseUrl
  if (providerType === "cloudflare" && !apiConfig.base_url && !chosen.base_url) {
    if (!accountId) {
      console.warn(
        `[ai-platforms] cloudflare platform ${chosen.id} has no account_id; can't derive base_url`
      )
      return null
    }
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
  }
  // FAL (and any future SDK-only provider) doesn't need a baseUrl —
  // the SDK calls FAL's gateway directly. All other providers must
  // resolve to one so the OpenAI-compatible adapter has somewhere to
  // point.
  if (!baseUrl && providerType !== "fal") {
    console.warn(
      `[ai-platforms] platform ${chosen.id} (provider=${providerType}) has no base_url`
    )
    return null
  }

  return {
    platformId: chosen.id,
    providerType,
    apiKey,
    baseUrl: baseUrl ?? "",
    defaultModel: apiConfig.default_model ?? meta.default_model ?? null,
    accountId,
  }
}

// ── AI SDK adapters ────────────────────────────────────────────────────

import { createOpenAI } from "@ai-sdk/openai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

/**
 * Build an AI SDK chat/language model from a resolved platform config.
 * Used with generateObject, generateText, streamText.
 *
 * `modelOverride` lets the caller pick a model at the call site,
 * defaulting to the platform's `default_model`, and falling back to
 * the provider-specific hint when nothing is configured.
 */
export const buildChatModel = (
  config: AiPlatformConfig,
  modelOverride?: string
) => {
  const id =
    modelOverride ??
    config.defaultModel ??
    PROVIDER_DEFAULTS[config.providerType].defaultModelHint ??
    ""

  if (config.providerType === "openrouter") {
    const router = createOpenRouter({ apiKey: config.apiKey })
    return router.chat(id)
  }
  const client = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })
  // Use the chat-completions API explicitly. In @ai-sdk/openai v2 the default
  // callable `client(id)` targets the Responses API (sends an `input` field),
  // which OpenAI-compatible endpoints (Cloudflare/DashScope/Vercel AI Gateway)
  // reject with "Unsupported field passed: input. Valid fields: messages…".
  // `.chat(id)` sends `messages`, matching those endpoints (and the openrouter
  // path above). Verified live against a Cloudflare ai_digest_summary platform.
  return client.chat(id)
}

/**
 * Build an AI SDK embedding model from a resolved platform config. The
 * caller is responsible for the dimension lock-in (see productCatalog
 * docstring).
 */
export const buildEmbeddingModel = (
  config: AiPlatformConfig,
  modelOverride?: string
) => {
  const id =
    modelOverride ??
    config.defaultModel ??
    PROVIDER_DEFAULTS[config.providerType].defaultModelHint ??
    ""

  // OpenRouter doesn't host embedding models — error early.
  if (config.providerType === "openrouter") {
    throw new Error(
      "OpenRouter does not host embedding models — pick dashscope / cloudflare / google / hf_local for the embed role"
    )
  }
  const client = createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })
  return client.embedding(id)
}

export const PROVIDER_TYPES: AiProviderType[] = [
  "openrouter",
  "dashscope",
  "cloudflare",
  "vercel_ai_gateway",
  "custom",
]

export const AI_ROLES: AiRole[] = [
  "ai_search_chat",
  "ai_search_embed",
  "ai_product_description",
]
