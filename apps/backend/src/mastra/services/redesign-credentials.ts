/**
 * Redesign credential resolution (#892).
 *
 * The Nano-Banana redesign engine runs `google/gemini-2.5-flash-image` through
 * OpenRouter (the only path that returned an edited image — the direct
 * @ai-sdk/google factory is spec-v3 and incompatible with ai@5's v2 runtime, and the
 * Vercel AI Gateway free tier is blocked from this model).
 *
 * Resolution order (mirrors resolveFalCredentials):
 *   1. External Platform (Settings → External Platforms) tagged role `ai_redesign`
 *      with provider_type=openrouter — the admin-configured, prod path.
 *   2. OPENROUTER_API_KEY env var — legacy / unconfigured deployments.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { getAiPlatformForRole } from "./ai-platforms"

export const DEFAULT_REDESIGN_MODEL = "google/gemini-2.5-flash-image"

export type RedesignCredentials = {
  apiKey: string
  model: string
  source: "platform" | "env"
}

export const resolveRedesignCredentials = async (
  container: MedusaContainer
): Promise<RedesignCredentials | null> => {
  try {
    const cfg = await getAiPlatformForRole(container, "ai_redesign")
    // Nano-Banana is only reachable through OpenRouter here, so require that type.
    if (cfg?.apiKey && cfg.providerType === "openrouter") {
      return {
        apiKey: cfg.apiKey,
        model: cfg.defaultModel || DEFAULT_REDESIGN_MODEL,
        source: "platform",
      }
    }
  } catch (err) {
    console.warn(
      "[redesign-credentials] platform lookup failed; falling back to env:",
      err instanceof Error ? err.message : err
    )
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: DEFAULT_REDESIGN_MODEL,
      source: "env",
    }
  }
  return null
}
