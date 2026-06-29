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
  // In-editor "Write with AI" for newsletters (#659). Resolves the drafting
  // provider from the admin-configured External Platform; falls back to the
  // OPENROUTER_API_KEY env var when no provider is tagged for this role.
  | "ai_newsletter_drafter"
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
 * Build the `generateText` arguments for a system + user prompt, in a shape the
 * given provider accepts.
 *
 * OpenRouter handles the AI-SDK `system` param natively. But OpenAI-compatible
 * endpoints (Cloudflare/DashScope/Vercel-AI-Gateway/custom) reject the role the
 * SDK emits for the system message — verified live against a Cloudflare minimax
 * platform: `Invalid value at messages[0].role: expected one of system|user|
 * assistant|tool`. Folding the system text into the single user message is
 * accepted everywhere, so we do that for the non-openrouter path. Pure.
 */
export const buildGenerateArgs = (
  config: Pick<AiPlatformConfig, "providerType">,
  system: string | undefined,
  prompt: string
): { system?: string; messages: Array<{ role: "user"; content: string }> } => {
  const sys = (system || "").trim()
  if (config.providerType === "openrouter") {
    return { ...(sys ? { system: sys } : {}), messages: [{ role: "user", content: prompt }] }
  }
  const content = sys ? `${sys}\n\n${prompt}` : prompt
  return { messages: [{ role: "user", content }] }
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

// ── Unified role → model resolution + usage logging ────────────────────

import { dynamicFreeTextModel } from "../providers/dynamic-text-model"

export type ResolvedRoleModel = {
  /** AI-SDK LanguageModel for generateText / generateObject / streamText. */
  model: any
  /** Provider behind the model — drives system-prompt placement (buildGenerateArgs). */
  providerType: AiProviderType
  /** "platform" when an admin-configured External Platform served the role,
   *  "free" when we fell back to the auto-rotating OpenRouter free models. */
  source: "platform" | "free"
  /** Set only when source==="platform". */
  platformId?: string
  /** Resolved model id (platform default, or "free-rotator" sentinel). */
  modelId?: string
}

/**
 * Single entry point every text AI feature should use to pick its model.
 *
 *   1. Admin-configured External Platform for `role` (metadata.role lookup) —
 *      this is the source of truth; uses the operator's chosen provider/model.
 *   2. Free fallback — the auto-rotating OpenRouter `:free` resolver
 *      (`dynamicFreeTextModel`). No paid hardcoded models.
 *
 * Never throws — a resolution failure degrades to the free fallback so a
 * feature never goes dark because of a transient platform error.
 */
export const resolveRoleTextModel = async (
  container: MedusaContainer,
  role: AiRole,
  modelOverride?: string
): Promise<ResolvedRoleModel> => {
  try {
    const cfg = await getAiPlatformForRole(container, role)
    if (cfg) {
      return {
        model: buildChatModel(cfg, modelOverride),
        providerType: cfg.providerType,
        source: "platform",
        platformId: cfg.platformId,
        modelId: modelOverride ?? cfg.defaultModel ?? undefined,
      }
    }
  } catch (e: any) {
    console.warn(
      `[ai-platforms] resolveRoleTextModel(${role}) failed, using free fallback: ${
        e?.message ?? e
      }`
    )
  }
  return {
    model: dynamicFreeTextModel,
    providerType: "openrouter",
    source: "free",
    modelId: "free-rotator",
  }
}

import { generateText } from "ai"

/**
 * Build a `(prompt) => Promise<string>` generator bound to a role — the shape
 * the marketing orchestrators (`opts.aiGenerate`) and any prompt-in/text-out
 * caller expect. Resolves the configured platform for `role` (free-model
 * fallback), folds the system prompt for OpenAI-compatible providers via
 * `buildGenerateArgs`, emits one `[ai-usage]` line, and returns "" on error so
 * callers keep their existing graceful-degrade contract.
 */
export const makeRoleAiGenerate = (
  container: MedusaContainer,
  role: AiRole,
  feature: string,
  opts: { system?: string; maxOutputTokens?: number } = {}
): ((prompt: string) => Promise<string>) => {
  return async (prompt: string): Promise<string> => {
    const resolved = await resolveRoleTextModel(container, role)
    let logger: any
    try {
      logger = container.resolve("logger")
    } catch {
      /* logger optional */
    }
    const started = Date.now()
    try {
      const res = await generateText({
        model: resolved.model,
        ...buildGenerateArgs({ providerType: resolved.providerType }, opts.system, prompt),
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      })
      logAiUsage(logger, {
        feature,
        role,
        provider: resolved.providerType,
        source: resolved.source,
        model: resolved.modelId,
        platformId: resolved.platformId,
        ok: true,
        ms: Date.now() - started,
        tokens: (res as any)?.usage?.totalTokens,
      })
      return (res.text || "").trim()
    } catch (error: any) {
      logAiUsage(logger, {
        feature,
        role,
        provider: resolved.providerType,
        source: resolved.source,
        model: resolved.modelId,
        platformId: resolved.platformId,
        ok: false,
        ms: Date.now() - started,
        error,
      })
      return ""
    }
  }
}

export type AiUsage = {
  /** Stable feature key, e.g. "store/ai/search", "marketing/ideas_email". */
  feature: string
  role: AiRole
  provider: AiProviderType
  source: "platform" | "free"
  ok: boolean
  model?: string
  platformId?: string
  /** Wall-clock duration of the model call, ms. */
  ms?: number
  /** Total tokens if the SDK reported usage. */
  tokens?: number
  /** Error message when ok===false. */
  error?: unknown
}

/**
 * Format a single structured AI-usage line. Pure — returned string is what
 * `logAiUsage` emits, so it's unit-testable without a logger.
 *
 * Shape: `[ai-usage] feature=… role=… provider=… source=… model=… ok=… ms=… tokens=… error=…`
 * Designed for CloudWatch grep/metric-filters ("when & how each AI feature ran").
 */
export const formatAiUsage = (u: AiUsage): string => {
  const parts = [
    `feature=${u.feature}`,
    `role=${u.role}`,
    `provider=${u.provider}`,
    `source=${u.source}`,
    u.model ? `model=${u.model}` : null,
    u.platformId ? `platform=${u.platformId}` : null,
    `ok=${u.ok}`,
    u.ms != null ? `ms=${Math.round(u.ms)}` : null,
    u.tokens != null ? `tokens=${u.tokens}` : null,
    u.ok ? null : `error=${String((u.error as any)?.message ?? u.error ?? "").slice(0, 200)}`,
  ].filter(Boolean)
  return `[ai-usage] ${parts.join(" ")}`
}

/**
 * Emit one structured AI-usage line. Medusa's Logger takes a single string;
 * success → info, failure → warn. Best-effort — never throws into the caller.
 */
export const logAiUsage = (logger: any, u: AiUsage): void => {
  try {
    const line = formatAiUsage(u)
    if (u.ok) logger?.info?.(line)
    else logger?.warn?.(line)
  } catch {
    /* logging must never break the AI call */
  }
}

/**
 * Place the system prompt for a `{role, content}` message list (the shape
 * Mastra's admin chat uses). OpenRouter keeps the native `system` role;
 * OpenAI-compatible providers get all system messages folded into the first
 * user message (avoids @ai-sdk/openai's `developer` role that DashScope
 * rejects — same fix as the storefront chat route, #752). Pure / testable.
 */
export const foldSystemContentMessages = <
  M extends { role: string; content: string }
>(
  providerType: AiProviderType,
  messages: M[]
): Array<{ role: string; content: string }> => {
  if (providerType === "openrouter") return messages.map((m) => ({ ...m }))

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim()
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }))

  if (!systemText) return rest

  const firstUser = rest.findIndex((m) => m.role === "user")
  if (firstUser === -1) {
    return [{ role: "user", content: systemText }, ...rest]
  }
  rest[firstUser] = {
    ...rest[firstUser],
    content: rest[firstUser].content
      ? `${systemText}\n\n${rest[firstUser].content}`
      : systemText,
  }
  return rest
}

// ── Category sweep / discovery (auto-pick up new providers + roles) ─────

export type AiPlatformCatalogEntry = {
  platformId: string
  name?: string
  /** metadata.role — null when the operator hasn't tagged one. */
  role: string | null
  providerType: AiProviderType | null
  defaultModel: string | null
  /** metadata.is_default — the chosen platform for its role. */
  isDefault: boolean
  status: string
  /** True when an api key is present (encrypted or plaintext) — usable now. */
  hasApiKey: boolean
}

/**
 * Pure: map raw `social_platform` rows (category=ai) into catalog entries.
 * Exported for unit testing — no container, no decryption.
 */
export const summarizeAiPlatformCatalog = (
  rows: any[]
): AiPlatformCatalogEntry[] =>
  (rows ?? []).map((p) => {
    const apiConfig = (p?.api_config ?? {}) as Record<string, any>
    const meta = (p?.metadata ?? {}) as Record<string, any>
    return {
      platformId: p?.id,
      name: p?.name ?? undefined,
      role: (meta.role as string) ?? null,
      providerType: normalizeProviderType(meta.provider_type ?? apiConfig.provider_type),
      defaultModel: apiConfig.default_model ?? meta.default_model ?? null,
      isDefault: meta.is_default === true,
      status: p?.status ?? "unknown",
      hasApiKey: Boolean(
        apiConfig.api_key_encrypted || apiConfig.api_key || apiConfig.encrypted_api_key
      ),
    }
  })

/**
 * Group a catalog by role. Roles with no `metadata.role` tag land under the
 * `"_untagged"` bucket. Pure — testable.
 */
export const groupAiCatalogByRole = (
  catalog: AiPlatformCatalogEntry[]
): Record<string, AiPlatformCatalogEntry[]> => {
  const out: Record<string, AiPlatformCatalogEntry[]> = {}
  for (const e of catalog) {
    const key = e.role ?? "_untagged"
    ;(out[key] ??= []).push(e)
  }
  return out
}

/**
 * Sweep every `category=ai` External Platform and return the discovered
 * catalog. This is the "discovery, not declaration" mechanism: any provider the
 * operator adds — including under a brand-new custom `metadata.role` — is picked
 * up automatically, no code change. Powers the visual-flow op role picker, an
 * admin discovery endpoint, and ops reporting. Never throws → `[]` on failure.
 */
export const sweepAiPlatformsByCategory = async (
  container: MedusaContainer,
  opts: { includeInactive?: boolean } = {}
): Promise<AiPlatformCatalogEntry[]> => {
  let socials: SocialsService
  try {
    socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  } catch {
    return []
  }
  try {
    const filters: any = { category: "ai" }
    if (!opts.includeInactive) filters.status = "active"
    const rows = await socials.listSocialPlatforms(filters, { take: 200 })
    return summarizeAiPlatformCatalog(rows ?? [])
  } catch (e: any) {
    console.warn(
      `[ai-platforms] sweepAiPlatformsByCategory failed: ${e?.message ?? e}`
    )
    return []
  }
}

export const PROVIDER_TYPES: AiProviderType[] = [
  "openrouter",
  "dashscope",
  "cloudflare",
  "vercel_ai_gateway",
  "custom",
]

// Backend canonical list of the known AI roles. Keep in sync with the admin
// dropdown (`src/admin/components/social-platforms/ai-roles.ts`
// → KNOWN_AI_ROLES). Custom (operator-coined) roles are still discovered at
// runtime by the category sweep — this list only drives "expected role"
// reporting (e.g. the AI-platform coverage Data Plumbing job, #756).
export const AI_ROLES: AiRole[] = [
  "ai_search_chat",
  "ai_search_embed",
  "ai_product_description",
  "ai_image_gen",
  "ai_digest_summary",
  "ai_newsletter_drafter",
]
