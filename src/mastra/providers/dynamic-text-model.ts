/**
 * Dynamic Free Text Model Provider
 *
 * Provides a LanguageModel that:
 * 1. Dynamically selects the best available free model from OpenRouter (realtime API lookup)
 * 2. Detects "free period has ended" errors and permanently evicts the expired model,
 *    then retries with the next available model — no human intervention needed.
 * 3. Falls back to the cheapest Vercel AI Gateway text model when all OpenRouter
 *    free models are exhausted or the API is unreachable.
 * 4. As a last resort, uses a static fallback list of known free models.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { gateway } from "ai"
import { fetchAllModels, filterFreeModels, OpenRouterModel } from "./openrouter"

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// Models that have permanently expired their free tier — never retry these.
const expiredModelIds = new Set<string>()

// In-process cache for the ranked free text model list from OpenRouter.
let cachedFreeTextModels: OpenRouterModel[] = []
let cacheTs = 0
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

// Vercel AI Gateway fallback model cache
let vercelFallbackModelId: string | null = null
let vercelCacheTs = 0
const VERCEL_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

// Last-resort static fallbacks (updated periodically)
const STATIC_FALLBACKS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
]

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
  // Bust cache so the next getBestFreeTextModelId() re-fetches
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
 * Returns null when the OpenRouter pool is empty.
 */
export async function getBestFreeTextModelId(): Promise<string | null> {
  const models = await refreshFreeTextModels()
  const available = models.filter((m) => !expiredModelIds.has(m.id))
  if (available.length > 0) {
    return available[0].id
  }
  return null
}

// ──────────────────────────────────────────────────────────────
// Vercel AI Gateway fallback
// ──────────────────────────────────────────────────────────────

async function resolveVercelFallbackId(): Promise<string | null> {
  const now = Date.now()
  if (vercelFallbackModelId && now - vercelCacheTs < VERCEL_CACHE_TTL) {
    return vercelFallbackModelId
  }

  try {
    const result = await (gateway as any).getAvailableModels()
    const allModels: any[] = result?.models ?? []

    // Exclude image/vision-only models
    const textModels = allModels.filter((m: any) => {
      const type: string = m.type ?? ""
      const id: string = m.id ?? ""
      const isImageOnly =
        type === "image" ||
        id.includes("imagen") ||
        id.includes("flux") ||
        id.includes("-image")
      return !isImageOnly
    })

    // Sort by input token price, cheapest first
    textModels.sort((a: any, b: any) => {
      const pa = parseFloat(a?.pricing?.input ?? "999")
      const pb = parseFloat(b?.pricing?.input ?? "999")
      return pa - pb
    })

    if (textModels.length > 0) {
      vercelFallbackModelId = textModels[0].id
      vercelCacheTs = now
      console.log(`[DynamicTextModel] Vercel fallback selected: ${vercelFallbackModelId}`)
      return vercelFallbackModelId
    }
  } catch (err) {
    console.warn("[DynamicTextModel] Vercel gateway model lookup failed:", err)
  }

  return null
}

// ──────────────────────────────────────────────────────────────
// Resolution chain
// ──────────────────────────────────────────────────────────────

interface ResolvedModel {
  model: any
  id: string
  source: "openrouter" | "vercel" | "static"
}

async function resolveModel(): Promise<ResolvedModel> {
  // 1. Best OpenRouter free model
  const freeId = await getBestFreeTextModelId()
  if (freeId) {
    return { model: openrouter(freeId), id: freeId, source: "openrouter" }
  }

  // 2. Cheapest Vercel AI Gateway text model
  const vercelId = await resolveVercelFallbackId()
  if (vercelId) {
    return { model: (gateway as any)(vercelId), id: vercelId, source: "vercel" }
  }

  // 3. Static fallback (best non-expired option)
  const staticId =
    STATIC_FALLBACKS.find((id) => !expiredModelIds.has(id)) ?? STATIC_FALLBACKS[0]
  console.warn(`[DynamicTextModel] Using static fallback: ${staticId}`)
  return { model: openrouter(staticId), id: staticId, source: "static" }
}

// ──────────────────────────────────────────────────────────────
// DynamicFreeTextModel — AI SDK v1 LanguageModel proxy
// ──────────────────────────────────────────────────────────────

/**
 * A LanguageModel that transparently resolves the best available
 * free text model at call-time, handling expiry and fallbacks.
 *
 * Drop-in replacement for any `openrouter("...")` or `openai("...")` call
 * in Mastra agent definitions.
 */
class DynamicFreeTextModel {
  readonly specificationVersion = "v1" as const
  readonly provider = "dynamic-free-text"
  readonly modelId = "dynamic-free-text"
  readonly defaultObjectGenerationMode = undefined as any

  async doGenerate(options: any): Promise<any> {
    const resolved = await resolveModel()
    console.log(`[DynamicTextModel] doGenerate → ${resolved.source}:${resolved.id}`)

    try {
      return await resolved.model.doGenerate(options)
    } catch (err) {
      if (isExpiredFreeModelError(err) && resolved.source !== "vercel") {
        markModelExpired(resolved.id)
        // One retry with the next model
        const retry = await resolveModel()
        console.log(`[DynamicTextModel] Retry doGenerate → ${retry.source}:${retry.id}`)
        return await retry.model.doGenerate(options)
      }
      throw err
    }
  }

  async doStream(options: any): Promise<any> {
    const resolved = await resolveModel()
    console.log(`[DynamicTextModel] doStream → ${resolved.source}:${resolved.id}`)

    try {
      return await resolved.model.doStream(options)
    } catch (err) {
      if (isExpiredFreeModelError(err) && resolved.source !== "vercel") {
        markModelExpired(resolved.id)
        const retry = await resolveModel()
        console.log(`[DynamicTextModel] Retry doStream → ${retry.source}:${retry.id}`)
        return await retry.model.doStream(options)
      }
      throw err
    }
  }
}

/**
 * Singleton dynamic free text model — use this as the `model` in Agent definitions.
 *
 * @example
 * ```ts
 * import { dynamicFreeTextModel } from "../providers/dynamic-text-model"
 *
 * const myAgent = new Agent({
 *   model: dynamicFreeTextModel as any,
 *   ...
 * })
 * ```
 */
export const dynamicFreeTextModel: any = new DynamicFreeTextModel()
