import type { AiProviderType } from "../../../../mastra/services/ai-platforms"

/**
 * The storefront chat route resolves its model via `resolveStorefrontChatModel`
 * (a pre-unification resolver), which returns a `provider` STRING rather than the
 * structured shape `resolveRoleTextModel` gives. This maps that string into the
 * fields `logAiUsage` needs so chat emits the same `[ai-usage]` telemetry as
 * every other AI feature.
 *
 * Provider string shapes (see storefront-chat.ts):
 *   - `db:<provider>:<platformId>`  → admin-configured External Platform
 *   - `<provider>:<model>`          → env-var fallback chain (DashScope/Cloudflare)
 *   - `openrouter:free`             → free OpenRouter rotator (last resort)
 *
 * `source` is binary (platform | free): `db:` → platform, everything else →
 * free (env / last-resort fallbacks; the `provider` field still carries the
 * real provider for those).  Pure / testable.
 */
export type ChatProviderInfo = {
  providerType: AiProviderType
  source: "platform" | "free"
  platformId?: string
  modelId?: string
}

export const parseChatProvider = (provider: string): ChatProviderInfo => {
  const parts = (provider || "").split(":")
  if (parts[0] === "db") {
    return {
      providerType: (parts[1] || "custom") as AiProviderType,
      source: "platform",
      platformId: parts[2] || undefined,
    }
  }
  return {
    providerType: (parts[0] || "openrouter") as AiProviderType,
    source: "free",
    modelId: parts.slice(1).join(":") || undefined,
  }
}
