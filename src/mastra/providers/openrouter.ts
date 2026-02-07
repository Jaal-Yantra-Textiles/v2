/**
 * OpenRouter Free Models Provider
 *
 * Fetches available free models from OpenRouter API and selects the best one
 * based on context length requirements.
 */

export interface OpenRouterModel {
  id: string
  name: string
  context_length: number
  pricing: {
    prompt: string
    completion: string
    request?: string
    image?: string
  }
  architecture?: {
    modality?: string // e.g., "text->text", "text+image->text"
    input_modalities?: string[] // e.g., ["text", "image"]
    output_modalities?: string[] // e.g., ["text"]
    tokenizer?: string
    instruct_type?: string
  }
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number
    is_moderated?: boolean
  }
  description?: string
}

export type InputModality = "text" | "image" | "audio" | "video"
export type OutputModality = "text" | "image" | "audio"

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[]
}

// Cache for free models (refreshed every 5 minutes)
let cachedFreeModels: OpenRouterModel[] = []
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch all available models from OpenRouter API
 */
export async function fetchAllModels(): Promise<OpenRouterModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
  }

  const data: OpenRouterModelsResponse = await response.json()
  return data.data || []
}

/**
 * Filter models to only free ones (pricing.prompt = "0" and pricing.completion = "0")
 */
export function filterFreeModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return models.filter((m) => {
    const promptFree = m.pricing?.prompt === "0" || parseFloat(m.pricing?.prompt || "1") === 0
    const completionFree = m.pricing?.completion === "0" || parseFloat(m.pricing?.completion || "1") === 0
    return promptFree && completionFree
  })
}

/**
 * Filter models by required input modalities
 * @param models - List of models to filter
 * @param requiredModalities - Array of required input modalities (e.g., ["image"])
 */
export function filterByInputModality(
  models: OpenRouterModel[],
  requiredModalities: InputModality[]
): OpenRouterModel[] {
  return models.filter((m) => {
    const inputModalities = m.architecture?.input_modalities || []
    // Check if the model supports ALL required modalities
    return requiredModalities.every((mod) => inputModalities.includes(mod))
  })
}

/**
 * Filter models by output modalities
 */
export function filterByOutputModality(
  models: OpenRouterModel[],
  requiredModalities: OutputModality[]
): OpenRouterModel[] {
  return models.filter((m) => {
    const outputModalities = m.architecture?.output_modalities || []
    return requiredModalities.every((mod) => outputModalities.includes(mod))
  })
}

// Separate cache for vision models
let cachedFreeVisionModels: OpenRouterModel[] = []
let visionCacheTimestamp = 0

/**
 * Get free models that support image input (vision models)
 */
export async function getFreeVisionModels(): Promise<OpenRouterModel[]> {
  const now = Date.now()

  if (cachedFreeVisionModels.length > 0 && now - visionCacheTimestamp < CACHE_TTL_MS) {
    return cachedFreeVisionModels
  }

  try {
    const allModels = await fetchAllModels()
    const freeModels = filterFreeModels(allModels)
    cachedFreeVisionModels = filterByInputModality(freeModels, ["image"])
    visionCacheTimestamp = now

    // Sort by context length descending
    cachedFreeVisionModels.sort((a, b) => (b.context_length || 0) - (a.context_length || 0))

    console.log(`[OpenRouter] Found ${cachedFreeVisionModels.length} free vision models:`,
      cachedFreeVisionModels.map(m => m.id).slice(0, 5))

    return cachedFreeVisionModels
  } catch (error) {
    if (cachedFreeVisionModels.length > 0) {
      console.warn("[OpenRouter] Failed to refresh vision models, using cache:", error)
      return cachedFreeVisionModels
    }
    throw error
  }
}

/**
 * Get free models with specific modality requirements
 */
export async function getFreeModelsByModality(options: {
  inputModalities?: InputModality[]
  outputModalities?: OutputModality[]
  minContextLength?: number
}): Promise<OpenRouterModel[]> {
  const allModels = await fetchAllModels()
  let filtered = filterFreeModels(allModels)

  if (options.inputModalities && options.inputModalities.length > 0) {
    filtered = filterByInputModality(filtered, options.inputModalities)
  }

  if (options.outputModalities && options.outputModalities.length > 0) {
    filtered = filterByOutputModality(filtered, options.outputModalities)
  }

  if (options.minContextLength) {
    const minCtx = options.minContextLength
    filtered = filtered.filter((m) => (m.context_length || 0) >= minCtx)
  }

  // Sort by context length descending
  filtered.sort((a, b) => (b.context_length || 0) - (a.context_length || 0))

  return filtered
}

/**
 * Select the best free vision model for image analysis tasks
 */
export async function selectBestFreeVisionModel(
  requiredContext: number = 4000
): Promise<OpenRouterModel | null> {
  const visionModels = await getFreeVisionModels()
  return selectBestModel(visionModels, requiredContext)
}

/**
 * Get cached free models, refreshing if cache is stale
 */
export async function getFreeModels(): Promise<OpenRouterModel[]> {
  const now = Date.now()

  if (cachedFreeModels.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedFreeModels
  }

  try {
    const allModels = await fetchAllModels()
    cachedFreeModels = filterFreeModels(allModels)
    cacheTimestamp = now

    // Sort by context length descending for convenience
    cachedFreeModels.sort((a, b) => (b.context_length || 0) - (a.context_length || 0))

    return cachedFreeModels
  } catch (error) {
    // If we have cached models and fetch fails, return cached
    if (cachedFreeModels.length > 0) {
      console.warn("[OpenRouter] Failed to refresh models, using cache:", error)
      return cachedFreeModels
    }
    throw error
  }
}

/**
 * Select the best free model based on required context length
 *
 * Strategy:
 * 1. Filter models with sufficient context length
 * 2. Sort by context length descending (prefer larger context)
 * 3. Return the first (largest context) model that fits
 * 4. Fallback to the model with the largest context if none fit
 */
export function selectBestModel(
  models: OpenRouterModel[],
  requiredContext: number
): OpenRouterModel | null {
  if (!models || models.length === 0) {
    return null
  }

  // Filter models that can handle the required context
  const suitable = models
    .filter((m) => (m.context_length || 0) >= requiredContext)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))

  if (suitable.length > 0) {
    return suitable[0]
  }

  // Fallback: return the model with the largest context available
  const sorted = [...models].sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
  return sorted[0] || null
}

/**
 * Estimate token count from text (rough approximation)
 * Uses ~4 characters per token as a general estimate
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Get the best free model for a given message and history
 */
export async function getBestFreeModelForContext(
  message: string,
  threadHistory?: Array<{ role: string; content: string }>
): Promise<OpenRouterModel | null> {
  const messageTokens = estimateTokens(message)
  const historyTokens = (threadHistory || []).reduce(
    (sum, msg) => sum + estimateTokens(msg.content || ""),
    0
  )

  // Add buffer for system prompt and response generation
  const requiredContext = messageTokens + historyTokens + 4000

  const freeModels = await getFreeModels()
  return selectBestModel(freeModels, requiredContext)
}

/**
 * Clear the model cache (useful for testing)
 */
export function clearModelCache(): void {
  cachedFreeModels = []
  cacheTimestamp = 0
  cachedFreeVisionModels = []
  visionCacheTimestamp = 0
  cachedVisionModelId = null
  visionModelIdTimestamp = 0
}

// ============================================
// Dynamic Vision Model Selection
// ============================================

// Cache for the selected best vision model ID
let cachedVisionModelId: string | null = null
let visionModelIdTimestamp = 0
const MODEL_ID_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Fallback vision models (ordered by preference)
const FALLBACK_VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-flash-1.5-8b-exp",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
]

/**
 * Get the best available free vision model ID with caching
 * Returns a model ID string suitable for use with createOpenRouter
 */
export async function getVisionModelId(): Promise<string> {
  const now = Date.now()

  // Return cached if still valid
  if (cachedVisionModelId && now - visionModelIdTimestamp < MODEL_ID_CACHE_TTL_MS) {
    return cachedVisionModelId
  }

  try {
    const bestModel = await selectBestFreeVisionModel(8000)
    if (bestModel) {
      cachedVisionModelId = bestModel.id
      visionModelIdTimestamp = now
      console.log(`[OpenRouter] Selected vision model: ${bestModel.id} (context: ${bestModel.context_length})`)
      return bestModel.id
    }
  } catch (error) {
    console.warn("[OpenRouter] Failed to select best vision model:", error)
  }

  // Fallback: try fallback models
  if (cachedVisionModelId) {
    console.log(`[OpenRouter] Using cached vision model: ${cachedVisionModelId}`)
    return cachedVisionModelId
  }

  // Use first fallback
  const fallback = FALLBACK_VISION_MODELS[0]
  console.log(`[OpenRouter] Using fallback vision model: ${fallback}`)
  return fallback
}

/**
 * Get the best available free text model ID with caching
 */
export async function getTextModelId(minContext: number = 4000): Promise<string> {
  try {
    const freeModels = await getFreeModels()
    const best = selectBestModel(freeModels, minContext)
    if (best) {
      return best.id
    }
  } catch (error) {
    console.warn("[OpenRouter] Failed to select best text model:", error)
  }

  // Fallback to a known free model
  return "nex-agi/deepseek-v3.1-nex-n1:free"
}
