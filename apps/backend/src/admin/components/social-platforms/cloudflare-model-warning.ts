/**
 * Pure helper — Cloudflare Workers AI free-tier model guard.
 *
 * Cloudflare exposes two AI surfaces behind the same OpenAI-compatible shape:
 *
 *   - **Workers AI (free)** — native models prefixed `@cf/…`
 *     (e.g. `@cf/meta/llama-3.1-8b-instruct`). These run on a free daily
 *     Neuron allocation on the `…/accounts/<id>/ai/v1` endpoint. No gateway
 *     balance / BYOK required.
 *   - **AI Gateway (paid / BYOK)** — any non-`@cf/…` model id (e.g.
 *     `minimax/m3`, `openai/gpt-4o`). These route through the paid gateway and
 *     fail with `Insufficient balance; add money to your gateway or use BYOK`
 *     (code 2021) unless a balance / BYOK key is configured.
 *
 * So a `cloudflare` AI platform whose `default_model` is a non-`@cf/…` id will
 * very likely fail at runtime on free credits. This helper surfaces that as an
 * admin warning. Kept pure (no React) so it's unit-testable and shareable by
 * the create form and the platform detail view.
 *
 * Surfaced by #613 (live CF test on the #589 digest AI provider).
 */

export const CF_NATIVE_PREFIX = "@cf/"

export const CF_FREE_MODEL_EXAMPLE = "@cf/meta/llama-3.1-8b-instruct"

/**
 * Returns a warning string when a Cloudflare AI platform's `default_model` is
 * set to a non-native id (one that won't run on the free Workers AI
 * allocation), or `null` when there's nothing to warn about:
 *   - provider is not `cloudflare`        → null (not our concern)
 *   - model is empty / whitespace         → null (provider default `@cf/…` is used)
 *   - model already starts with `@cf/`    → null (native, free)
 */
export const getCloudflareModelWarning = (
  providerType: string | null | undefined,
  defaultModel: string | null | undefined
): string | null => {
  if (providerType !== "cloudflare") {
    return null
  }
  const model = (defaultModel ?? "").trim()
  if (model.length === 0) {
    return null
  }
  if (model.startsWith(CF_NATIVE_PREFIX)) {
    return null
  }
  return (
    `“${model}” is not a native Workers AI model. Cloudflare runs native ` +
    `${CF_NATIVE_PREFIX}… models on the free daily allocation; other ids route ` +
    `through the paid AI Gateway / BYOK path and usually fail with ` +
    `“Insufficient balance”. Use a ${CF_NATIVE_PREFIX}… model (e.g. ` +
    `${CF_FREE_MODEL_EXAMPLE}) for free usage.`
  )
}
