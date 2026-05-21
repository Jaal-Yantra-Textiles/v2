/**
 * FAL credential resolution.
 *
 * FAL ai/* image-generation endpoints use their own SDK (@fal-ai/client)
 * rather than an OpenAI-compatible interface, so we expose a thin helper
 * that just returns the API key string.
 *
 * Resolution order:
 *   1. SocialPlatform row with category=ai, metadata.role=ai_image_gen,
 *      metadata.provider_type=fal, metadata.is_default=true (admin config)
 *   2. FAL_KEY env var (legacy / unconfigured deployments)
 *
 * Returns null if neither is available — callers should error with a
 * helpful message rather than calling FAL with an empty credential.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { getAiPlatformForRole } from "./ai-platforms"

export const resolveFalCredentials = async (
  container?: MedusaContainer
): Promise<string | null> => {
  if (container) {
    try {
      const cfg = await getAiPlatformForRole(container, "ai_image_gen")
      // Accept either a fal-specific platform OR any platform with the
      // ai_image_gen role — if an admin wired in a custom OpenAI-style
      // image gen they'd put it under a different role; FAL is the only
      // image-gen provider in v1 so this still does the right thing.
      if (cfg && cfg.apiKey) return cfg.apiKey
    } catch (e: any) {
      console.warn(
        "[fal-credentials] db lookup failed; falling through to env:",
        e?.message ?? e
      )
    }
  }
  return process.env.FAL_KEY ?? null
}
