/**
 * FAL image generation, driven by the configured `ai_image_gen` platform.
 *
 * ## Why this exists
 *
 * The design generator only ever recognised `provider_type === "cloudflare"`.
 * Production's `ai_image_gen` platform is **fal**, so the configured platform
 * matched nothing: image generation silently fell through to the env-keyed
 * provider chain, and prompt enhancement fell back to the OpenRouter free
 * rotator — the very dependency #1669 set out to remove. The platform row was
 * present, active, and had a key, and none of it was reached.
 *
 * FAL already had a home here (`resolveFalCredentials`, try-on, segment, depth)
 * — it just had no generator on this path.
 *
 * ⚠️ FAL speaks its own SDK rather than an OpenAI-compatible interface, and it
 * is image-only: there is no text model here for prompt enhancement. That is
 * resolved separately — see `prompt_model_config` on the trigger schema.
 */

export type FalImageConfig = {
  api_key: string
  /** Model id; defaults to FLUX schnell, FAL's fast text-to-image endpoint. */
  model?: string | null
}

export type FalGenerationResult = {
  success: boolean
  imageUrl?: string
  provider: "fal"
  modelUsed?: string
  error?: string
  errorCode?: "RATE_LIMITED" | "SERVER_ERROR" | "NETWORK_ERROR" | "UNKNOWN"
}

const DEFAULT_MODEL = "fal-ai/flux/schnell"

/**
 * 🔑 The dynamic import is deliberate and matches `try-on-garment`: this module
 * is reachable from the Mastra runtime, and a top-level `@fal-ai/client` import
 * would pull the SDK into every workflow that merely touches the imagegen
 * barrel — including the ones that run in tests with no FAL key at all.
 */
export const generateWithFal = async (
  prompt: string,
  config: FalImageConfig
): Promise<FalGenerationResult> => {
  const model = config.model || DEFAULT_MODEL

  try {
    const { fal } = await import("@fal-ai/client")
    fal.config({ credentials: config.api_key })

    const result: any = await fal.subscribe(model, {
      input: { prompt },
      logs: false,
    })

    // FAL returns `{ data: { images: [{ url }] } }` on current client versions
    // and a bare `{ images: [...] }` on older ones. Read both rather than
    // pinning to one shape — a null here surfaces as "no image" with no clue
    // which half was missing.
    const images =
      result?.data?.images ?? result?.images ?? result?.data?.image ?? null
    const url = Array.isArray(images) ? images[0]?.url : images?.url

    if (!url || typeof url !== "string") {
      return {
        success: false,
        provider: "fal",
        modelUsed: model,
        error: "FAL returned no image URL",
        errorCode: "UNKNOWN",
      }
    }

    return { success: true, imageUrl: url, provider: "fal", modelUsed: model }
  } catch (err: any) {
    const message = String(err?.message ?? err)
    const status = Number(err?.status ?? err?.response?.status ?? 0)
    return {
      success: false,
      provider: "fal",
      modelUsed: model,
      error: message,
      errorCode:
        status === 429 || /rate.?limit/i.test(message)
          ? "RATE_LIMITED"
          : status >= 500
            ? "SERVER_ERROR"
            : /fetch|network|ECONN|timeout/i.test(message)
              ? "NETWORK_ERROR"
              : "UNKNOWN",
    }
  }
}
