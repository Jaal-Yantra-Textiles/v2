/**
 * Pure helper for POST /admin/marketing/newsletter/generate — decides WHICH
 * 503 body to return when the AI produced no output, so the message stops
 * conflating "no provider configured" with "the resolved provider failed".
 *
 * Two decision branches (see #701):
 *  (a) no provider resolved AND no OPENROUTER_API_KEY → "configure a provider"
 *  (b) a provider DID resolve (or the env fallback ran) but the call threw /
 *      returned empty → name the resolved providerType + model + the real error.
 */

export const NO_PROVIDER_CONFIGURED_MESSAGE =
  "No AI provider available. Configure a social-platform AI provider with role 'ai_newsletter_drafter', or set OPENROUTER_API_KEY."

export type NoOutputErrorInput = {
  /** true when getAiPlatformForRole returned a non-null platform */
  providerResolved: boolean
  /** resolved provider type (e.g. "dashscope"), when providerResolved */
  providerType?: string | null
  /** resolved model id, when providerResolved */
  model?: string | null
  /** message of any error thrown by generateText, if it threw */
  error?: string | null
  /** true when OPENROUTER_API_KEY is set (env fallback path) */
  hasEnvKey: boolean
}

/**
 * @returns the 503 `error` body string. Branch (a) keeps the legacy
 * "configure a provider" copy; branch (b) names the provider that actually
 * ran and the real failure, so an empty "thinking"-model response no longer
 * masquerades as a config problem.
 */
export function buildNoOutputError(input: NoOutputErrorInput): string {
  const { providerResolved, providerType, model, error, hasEnvKey } = input

  // (a) nothing was even attempted — the genuine "not configured" case.
  if (!providerResolved && !hasEnvKey) {
    return NO_PROVIDER_CONFIGURED_MESSAGE
  }

  // (b) a real provider ran (admin platform or env fallback) but yielded
  // nothing. Name who ran and surface the underlying error.
  const who = providerResolved
    ? `${providerType || "unknown"}/${model || "default"}`
    : "openrouter/env"
  const detail = error && error.trim() ? error.trim() : "no text in response"
  return `AI provider (${who}) returned no output: ${detail}`
}
