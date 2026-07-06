/**
 * Redesign credential + engine resolution (#892).
 *
 * Nano-Banana (`gemini-2.5-flash-image`) is reachable through more than one provider,
 * so redesign is NOT locked to any single one. We resolve BOTH which provider to use
 * and its key, in this order:
 *
 *   1. External Platform (Settings → External Platforms) tagged role `ai_redesign`:
 *        - provider_type=openrouter → OpenRouter engine
 *        - provider_type=google     → direct Google engine
 *      This is the admin-configured, prod path — swap providers with zero code change.
 *   2. OPENROUTER_API_KEY env → OpenRouter engine.
 *   3. GOOGLE_GENERATIVE_AI_API_KEY env → direct Google engine.
 *
 * (Mirrors resolveFalCredentials' platform-then-env fallback.)
 */
import type { MedusaContainer } from "@medusajs/framework"
import { getAiPlatformForRole } from "./ai-platforms"
import type { RedesignEngine } from "../../api/admin/designs/[id]/redesign/redesign-engines"

// OpenRouter uses the slash-namespaced id; the direct Google API uses the bare id.
export const OPENROUTER_REDESIGN_MODEL = "google/gemini-2.5-flash-image"
export const GOOGLE_REDESIGN_MODEL = "gemini-2.5-flash-image"
/** Default advertised in responses / mocks (the OpenRouter form). */
export const DEFAULT_REDESIGN_MODEL = OPENROUTER_REDESIGN_MODEL

export type RedesignCredentials = {
  engine: RedesignEngine
  apiKey: string
  model: string
  source: "platform" | "env"
}

export const resolveRedesignCredentials = async (
  container: MedusaContainer
): Promise<RedesignCredentials | null> => {
  try {
    const cfg = await getAiPlatformForRole(container, "ai_redesign")
    if (cfg?.apiKey) {
      if (cfg.providerType === "openrouter") {
        return {
          engine: "openrouter",
          apiKey: cfg.apiKey,
          model: cfg.defaultModel || OPENROUTER_REDESIGN_MODEL,
          source: "platform",
        }
      }
      // ai-platforms doesn't ship a native "google" provider_type today, but honour
      // one if an admin tags it — the direct engine only needs a key + a bare model id.
      if ((cfg.providerType as string) === "google") {
        return {
          engine: "google",
          apiKey: cfg.apiKey,
          model: cfg.defaultModel || GOOGLE_REDESIGN_MODEL,
          source: "platform",
        }
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
      engine: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: OPENROUTER_REDESIGN_MODEL,
      source: "env",
    }
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      engine: "google",
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      model: GOOGLE_REDESIGN_MODEL,
      source: "env",
    }
  }
  return null
}
