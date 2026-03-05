/**
 * Dynamic Free Text Model Provider
 *
 * Provides a proper AI SDK v5 LanguageModel (via wrapLanguageModel) that:
 * 1. Dynamically selects the best available free model from OpenRouter (realtime API lookup)
 * 2. Detects "free period has ended" errors and permanently evicts the expired model,
 *    then retries with the next available model — no human intervention needed.
 * 3. Falls back to the cheapest Vercel AI Gateway text model when all OpenRouter
 *    free models are exhausted or the API is unreachable.
 * 4. As a last resort, uses a static fallback list of known free models.
 *
 * Uses wrapLanguageModel so Mastra recognises it as a proper AI SDK v5 model.
 * The placeholder model passed to wrapLanguageModel is never actually called —
 * both wrapGenerate and wrapStream completely bypass it.
 */

import { wrapLanguageModel } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { fetchAllModels, filterFreeModels, OpenRouterModel } from "./openrouter"

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// ──────────────────────────────────────────────────────────────
// Static fallbacks — known working free models (updated periodically)
// ──────────────────────────────────────────────────────────────
const STATIC_FALLBACKS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
]

// Models that have permanently expired their free tier — never retry these.
const expiredModelIds = new Set<string>()

// In-process cache for the ranked free text model list from OpenRouter.
let cachedFreeTextModels: OpenRouterModel[] = []
let cacheTs = 0
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

// ──────────────────────────────────────────────────────────────
// Expiry detection
// ──────────────────────────────────────────────────────────────

/**
 * Returns true when an OpenRouter error indicates that a model's
 * free tier has permanently ended (not a transient rate-limit).
 */
export function isExpiredFreeModelError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? "").toLowerCase()
  return (
    msg.includes("period has ended") ||
    msg.includes("migrate to the paid") ||
    msg.includes("no longer available for free") ||
    (msg.includes("free") && msg.includes("ended"))
  )
}

/**
 * Permanently evict a model ID from the free-model pool and invalidate
 * the in-process cache so the next call re-ranks from the live list.
 */
export function markModelExpired(modelId: string): void {
  if (expiredModelIds.has(modelId)) return
  console.warn(`[DynamicTextModel] Model expired — evicting: ${modelId}`)
  expiredModelIds.add(modelId)
  cachedFreeTextModels = []
  cacheTs = 0
}

// ──────────────────────────────────────────────────────────────
// OpenRouter free model resolution
// ──────────────────────────────────────────────────────────────

async function refreshFreeTextModels(): Promise<OpenRouterModel[]> {
  const now = Date.now()
  if (cachedFreeTextModels.length > 0 && now - cacheTs < CACHE_TTL) {
    return cachedFreeTextModels
  }

  try {
    const allModels = await fetchAllModels()
    let free = filterFreeModels(allModels)

    // Keep only models that produce text output
    free = free.filter((m) => {
      const out = m.architecture?.output_modalities ?? []
      return out.length === 0 || out.includes("text")
    })

    // Largest context first — generally the most capable free models
    free.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))

    cachedFreeTextModels = free
    cacheTs = now
    console.log(`[DynamicTextModel] Refreshed OpenRouter pool — ${free.length} free text models`)
    return free
  } catch (err) {
    console.warn("[DynamicTextModel] OpenRouter model refresh failed:", err)
    return cachedFreeTextModels
  }
}

/**
 * Return the ID of the best currently-available free text model,
 * skipping any that have been marked expired.
 */
export async function getBestFreeTextModelId(): Promise<string | null> {
  const models = await refreshFreeTextModels()
  const available = models.filter((m) => !expiredModelIds.has(m.id))
  return available.length > 0 ? available[0].id : null
}

/**
 * Resolve the best available model instance, falling back through:
 *   1. OpenRouter live free model list
 *   2. Static fallback list
 */
async function resolveModel(): Promise<{ model: any; id: string }> {
  const freeId = await getBestFreeTextModelId()
  if (freeId) {
    return { model: openrouter(freeId), id: freeId }
  }

  const staticId = STATIC_FALLBACKS.find((id) => !expiredModelIds.has(id)) ?? STATIC_FALLBACKS[0]
  console.warn(`[DynamicTextModel] Using static fallback: ${staticId}`)
  return { model: openrouter(staticId), id: staticId }
}

// ──────────────────────────────────────────────────────────────
// wrapLanguageModel — produces a proper AI SDK v5 LanguageModel
//
// The placeholder model is required by the API but is never called:
// both wrapGenerate and wrapStream completely bypass it and
// delegate directly to the dynamically resolved model.
// ──────────────────────────────────────────────────────────────

const placeholder = openrouter(STATIC_FALLBACKS[0])

/**
 * A proper AI SDK v5 LanguageModel (recognised by Mastra) that transparently
 * resolves the best available free text model at call-time.
 *
 * Drop-in replacement for any `openrouter("...")` or `openai("...")` call
 * in Mastra agent definitions.
 */
export const dynamicFreeTextModel = wrapLanguageModel({
  model: placeholder,
  middleware: {
    wrapGenerate: async ({ params }) => {
      const { model, id } = await resolveModel()
      console.log(`[DynamicTextModel] generate → ${id}`)
      try {
        return await model.doGenerate(params)
      } catch (err) {
        if (isExpiredFreeModelError(err)) {
          markModelExpired(id)
          const retry = await resolveModel()
          console.log(`[DynamicTextModel] retry generate → ${retry.id}`)
          return await retry.model.doGenerate(params)
        }
        throw err
      }
    },
    wrapStream: async ({ params }) => {
      const { model, id } = await resolveModel()
      console.log(`[DynamicTextModel] stream → ${id}`)
      try {
        return await model.doStream(params)
      } catch (err) {
        if (isExpiredFreeModelError(err)) {
          markModelExpired(id)
          const retry = await resolveModel()
          console.log(`[DynamicTextModel] retry stream → ${retry.id}`)
          return await retry.model.doStream(params)
        }
        throw err
      }
    },
  },
})
