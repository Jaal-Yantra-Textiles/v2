/**
 * Model Rotator Service
 *
 * Manages model rotation across workflow steps to avoid rate limits.
 * Each workflow step gets assigned a different model from the free model pool.
 *
 * This prevents 429 errors when multiple LLM calls are made in sequence
 * (e.g., intent classification → query planning → response generation).
 *
 * Models are dynamically fetched from OpenRouter API to ensure we always
 * have the latest available free models.
 *
 * Phase 14: Added configurable delays between LLM calls
 */

import { modelRotatorLogger as log } from "./logger"

// ============================================
// DELAY CONFIGURATION
// ============================================

/**
 * Delay configuration for avoiding rate limits
 */
interface DelayConfig {
  /** Minimum delay between LLM calls (ms) */
  minDelayMs: number
  /** Additional delay after rate limit error (ms) */
  rateLimitDelayMs: number
  /** Whether to add jitter to delays */
  useJitter: boolean
}

const DEFAULT_DELAY_CONFIG: DelayConfig = {
  minDelayMs: parseInt(process.env.AI_LLM_MIN_DELAY_MS || "1500", 10), // 1.5 seconds
  rateLimitDelayMs: parseInt(process.env.AI_LLM_RATE_LIMIT_DELAY_MS || "5000", 10), // 5 seconds
  useJitter: true,
}

// Track last LLM call time for global pacing
let lastLLMCallTime = 0

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Add jitter to a delay (±20%)
 */
function addJitter(delayMs: number): number {
  if (!DEFAULT_DELAY_CONFIG.useJitter) return delayMs
  const jitter = delayMs * 0.2 * (Math.random() * 2 - 1) // ±20%
  return Math.max(100, Math.round(delayMs + jitter))
}

/**
 * Wait for minimum delay since last LLM call
 * This helps avoid rate limits by spacing out calls
 */
export async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const timeSinceLastCall = now - lastLLMCallTime
  const requiredDelay = addJitter(DEFAULT_DELAY_CONFIG.minDelayMs)

  if (timeSinceLastCall < requiredDelay) {
    const waitTime = requiredDelay - timeSinceLastCall
    log.debug("Waiting before next LLM call (rate limit protection)", { waitTimeMs: waitTime })
    await sleep(waitTime)
  }

  lastLLMCallTime = Date.now()
}

/**
 * Wait after encountering a rate limit error
 */
export async function waitAfterRateLimit(): Promise<void> {
  const waitTime = addJitter(DEFAULT_DELAY_CONFIG.rateLimitDelayMs)
  log.info("Waiting after rate limit error", { waitTimeMs: waitTime })
  await sleep(waitTime)
  lastLLMCallTime = Date.now()
}

/**
 * Get current delay configuration
 */
export function getDelayConfig(): DelayConfig {
  return { ...DEFAULT_DELAY_CONFIG }
}

/**
 * Update delay configuration at runtime
 */
export function setDelayConfig(config: Partial<DelayConfig>): void {
  if (config.minDelayMs !== undefined) DEFAULT_DELAY_CONFIG.minDelayMs = config.minDelayMs
  if (config.rateLimitDelayMs !== undefined) DEFAULT_DELAY_CONFIG.rateLimitDelayMs = config.rateLimitDelayMs
  if (config.useJitter !== undefined) DEFAULT_DELAY_CONFIG.useJitter = config.useJitter
  log.info("Delay config updated", DEFAULT_DELAY_CONFIG)
}

// ============================================
// DYNAMIC FREE MODELS LOADING
// ============================================

interface OpenRouterModel {
  id: string
  name: string
  context_length: number
  pricing: {
    prompt: string
    completion: string
  }
}

// Cache for free models
let cachedFreeModels: string[] = []
let cacheTimestamp = 0
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes cache

// Fallback models in case API fetch fails (known working free models)
const FALLBACK_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
]

/**
 * Fetch free models from OpenRouter API
 */
async function fetchFreeModelsFromAPI(): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`)
    }

    const data = await response.json()
    const models: OpenRouterModel[] = data.data || []

    // Filter to only free models (prompt and completion pricing = "0")
    const freeModels = models
      .filter((m) => {
        const promptFree = m.pricing?.prompt === "0" || parseFloat(m.pricing?.prompt || "1") === 0
        const completionFree = m.pricing?.completion === "0" || parseFloat(m.pricing?.completion || "1") === 0
        return promptFree && completionFree
      })
      .sort((a, b) => (b.context_length || 0) - (a.context_length || 0)) // Sort by context length
      .map((m) => m.id)

    log.info("Fetched free models from OpenRouter API", { count: freeModels.length })

    return freeModels
  } catch (error) {
    log.error("Failed to fetch free models from API", { error: String(error) })
    return []
  }
}

/**
 * Get cached free models, refreshing if stale
 */
async function getFreeModels(): Promise<string[]> {
  const now = Date.now()

  if (cachedFreeModels.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedFreeModels
  }

  const freshModels = await fetchFreeModelsFromAPI()

  if (freshModels.length > 0) {
    cachedFreeModels = freshModels
    cacheTimestamp = now
    return cachedFreeModels
  }

  // If fetch failed and we have cached models, use them
  if (cachedFreeModels.length > 0) {
    log.warn("Using stale cached models")
    return cachedFreeModels
  }

  // Last resort: use fallback models
  log.warn("Using fallback free models")
  return FALLBACK_FREE_MODELS
}

/**
 * Synchronous access to currently cached models (for status display)
 */
function getCachedModels(): string[] {
  return cachedFreeModels.length > 0 ? cachedFreeModels : FALLBACK_FREE_MODELS
}

// ============================================
// WORKFLOW STEP CONFIGURATION
// ============================================

/**
 * Workflow steps that require LLM calls
 */
export type WorkflowStep =
  | "intent_classification"
  | "query_planning"
  | "step_evaluation"
  | "response_generation"

/**
 * Model preferences for each workflow step
 * These are patterns/keywords to match against available models
 *
 * Strategy:
 * - Intent classification: Use fast/small models (classification is simple)
 * - Query planning: Use reasoning-capable models (needs JSON output)
 * - Step evaluation: Use small models (simple checks)
 * - Response generation: Use best available models (user-facing output)
 */
const STEP_MODEL_PREFERENCES: Record<WorkflowStep, string[]> = {
  // Intent classification: Prefer smaller, faster models
  intent_classification: [
    "gemma-3-12b",
    "gemma-3-4b",
    "mistral-7b",
    "qwen3-4b",
  ],

  // Query planning: Prefer capable reasoning models
  query_planning: [
    "gemma-3-27b",
    "llama-3.3-70b",
    "mistral-small",
    "gemini-2.0-flash",
  ],

  // Step evaluation: Prefer small/fast models
  step_evaluation: [
    "mistral-7b",
    "gemma-3-4b",
    "qwen3-4b",
  ],

  // Response generation: Prefer best quality models
  response_generation: [
    "llama-3.3-70b",
    "hermes-3-llama",
    "gemini-2.0-flash",
    "gemma-3-27b",
  ],
}

/**
 * Get models for a step based on preferences and available models
 */
async function getModelsForStepAsync(step: WorkflowStep): Promise<string[]> {
  const freeModels = await getFreeModels()
  const preferences = STEP_MODEL_PREFERENCES[step]

  // Find models matching preferences (in order of preference)
  const preferredModels: string[] = []
  for (const pref of preferences) {
    const matching = freeModels.filter((m) => m.toLowerCase().includes(pref.toLowerCase()))
    for (const match of matching) {
      if (!preferredModels.includes(match)) {
        preferredModels.push(match)
      }
    }
  }

  // If we found preferred models, use them; otherwise use all free models
  if (preferredModels.length > 0) {
    return preferredModels
  }

  // Fallback to all available free models
  return freeModels.length > 0 ? freeModels : FALLBACK_FREE_MODELS
}

/**
 * Rate limit tracking per model
 */
interface RateLimitInfo {
  rateLimitedUntil: number
  consecutiveFailures: number
}

const rateLimitedModels = new Map<string, RateLimitInfo>()
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000 // 1 minute base cooldown
const MAX_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes max cooldown

/**
 * Per-request model usage tracking to avoid using same model twice in one request
 */
const requestModelUsage = new Map<string, Set<string>>()

/**
 * Clean up old request tracking entries (older than 5 minutes)
 */
function cleanupOldRequests(): void {
  const now = Date.now()
  const maxAge = 5 * 60 * 1000 // 5 minutes

  // Use Array.from for compatibility with older TypeScript targets
  Array.from(requestModelUsage.entries()).forEach(([requestId]) => {
    // Request IDs include timestamp, extract and check
    const timestamp = parseInt(requestId.split("-")[0] || "0", 10)
    if (now - timestamp > maxAge) {
      requestModelUsage.delete(requestId)
    }
  })
}

/**
 * Generate a unique request ID for tracking model usage within a request
 */
export function generateRequestId(): string {
  cleanupOldRequests()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Check if a model is currently rate limited
 */
export function isModelRateLimited(modelId: string): boolean {
  const info = rateLimitedModels.get(modelId)
  if (!info) return false

  if (Date.now() >= info.rateLimitedUntil) {
    // Cooldown expired, reset
    rateLimitedModels.delete(modelId)
    return false
  }

  return true
}

/**
 * Mark a model as rate limited with exponential backoff
 */
export function markModelRateLimited(modelId: string): void {
  const existing = rateLimitedModels.get(modelId)
  const failures = (existing?.consecutiveFailures || 0) + 1

  // Exponential backoff: 1min, 2min, 4min, 5min (max)
  const cooldown = Math.min(
    RATE_LIMIT_COOLDOWN_MS * Math.pow(2, failures - 1),
    MAX_COOLDOWN_MS
  )

  rateLimitedModels.set(modelId, {
    rateLimitedUntil: Date.now() + cooldown,
    consecutiveFailures: failures,
  })

  log.warn("Model rate-limited", {
    modelId,
    cooldownSeconds: cooldown / 1000,
    failureCount: failures,
  })
}

/**
 * Mark a model as successfully used (reset failure count)
 */
export function markModelSuccess(modelId: string): void {
  const existing = rateLimitedModels.get(modelId)
  if (existing) {
    // Reset consecutive failures on success
    rateLimitedModels.delete(modelId)
  }
}

/**
 * Record that a model was used for a specific request
 */
function recordModelUsage(requestId: string, modelId: string): void {
  if (!requestModelUsage.has(requestId)) {
    requestModelUsage.set(requestId, new Set())
  }
  requestModelUsage.get(requestId)!.add(modelId)
}

/**
 * Check if a model was already used in this request
 */
function wasModelUsedInRequest(requestId: string, modelId: string): boolean {
  return requestModelUsage.get(requestId)?.has(modelId) || false
}

/**
 * Get available models for a workflow step (async version)
 * Fetches fresh models from API if cache is stale
 *
 * Considers:
 * 1. Step-specific model preferences
 * 2. Rate-limited models
 * 3. Models already used in this request (avoided if possible)
 */
export async function getModelsForStep(
  step: WorkflowStep,
  requestId?: string
): Promise<string[]> {
  // Get preferred models for this step
  const preferredModels = await getModelsForStepAsync(step)

  // Filter out rate-limited models
  let available = preferredModels.filter((m: string) => !isModelRateLimited(m))

  // If we have a request ID, prefer models not yet used in this request
  if (requestId && available.length > 1) {
    const notUsedYet = available.filter(
      (m: string) => !wasModelUsedInRequest(requestId, m)
    )
    if (notUsedYet.length > 0) {
      available = notUsedYet
    }
  }

  // If all preferred models are rate-limited, fall back to any available free model
  if (available.length === 0) {
    const allFreeModels = await getFreeModels()
    available = allFreeModels.filter((m: string) => !isModelRateLimited(m))
  }

  // If still nothing, return fallback models
  if (available.length === 0) {
    log.warn("All models rate-limited, returning fallback list", { step })
    return FALLBACK_FREE_MODELS
  }

  return available
}

/**
 * Get the primary (first choice) model for a workflow step
 */
export async function getPrimaryModelForStep(
  step: WorkflowStep,
  requestId?: string
): Promise<string> {
  const models = await getModelsForStep(step, requestId)
  return models[0] || FALLBACK_FREE_MODELS[0]
}

/**
 * Get all fallback models for a step (excluding the primary)
 */
export async function getFallbackModelsForStep(
  step: WorkflowStep,
  primaryModel: string,
  requestId?: string
): Promise<string[]> {
  const models = await getModelsForStep(step, requestId)
  return models.filter((m) => m !== primaryModel)
}

/**
 * Try to execute an LLM call with automatic model rotation on rate limits
 * Phase 14: Added automatic delay between calls to prevent rate limits
 */
export async function executeWithModelRotation<T>(
  step: WorkflowStep,
  requestId: string,
  executor: (modelId: string) => Promise<T>
): Promise<{ result: T; usedModel: string }> {
  const models = await getModelsForStep(step, requestId)

  let lastError: any = null

  for (const modelId of models) {
    try {
      // Wait for rate limit protection before making the call
      await waitForRateLimit()

      log.debug("Trying model for step", { step, modelId })
      recordModelUsage(requestId, modelId)

      const result = await executor(modelId)

      // Success - mark model as working
      markModelSuccess(modelId)
      log.info("Model succeeded", { step, modelId })

      return { result, usedModel: modelId }
    } catch (error: any) {
      lastError = error
      log.error("Model failed for step", { step, modelId, error: error?.message || String(error) })

      // Check if it's a rate limit error
      if (isRateLimitError(error)) {
        markModelRateLimited(modelId)
        // Wait extra time after rate limit before trying next model
        await waitAfterRateLimit()
        continue // Try next model
      }

      // For non-rate-limit errors, still try next model (with normal delay)
      continue
    }
  }

  // All models failed
  throw new Error(
    `All models failed for ${step}. Last error: ${lastError?.message || lastError}`
  )
}

/**
 * Check if an error is a rate limit error (HTTP 429)
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false

  const errorStr = String(error?.message || error || "").toLowerCase()

  // Check for common rate limit indicators
  if (
    errorStr.includes("429") ||
    errorStr.includes("rate limit") ||
    errorStr.includes("rate-limit") ||
    errorStr.includes("too many requests") ||
    errorStr.includes("temporarily rate-limited") ||
    errorStr.includes("quota exceeded")
  ) {
    return true
  }

  // Check error status code
  if (error?.status === 429 || error?.statusCode === 429) {
    return true
  }

  return false
}

/**
 * Get status of all cached models (for debugging)
 * Uses synchronously cached models to avoid async in status display
 */
export function getModelStatus(): Record<
  string,
  { available: boolean; rateLimitedFor?: number }
> {
  const status: Record<string, { available: boolean; rateLimitedFor?: number }> =
    {}

  const models = getCachedModels()

  for (const model of models) {
    const info = rateLimitedModels.get(model)
    if (info && Date.now() < info.rateLimitedUntil) {
      status[model] = {
        available: false,
        rateLimitedFor: Math.ceil((info.rateLimitedUntil - Date.now()) / 1000),
      }
    } else {
      status[model] = { available: true }
    }
  }

  return status
}

/**
 * Clear rate limit tracking (for testing)
 */
export function clearRateLimitTracking(): void {
  rateLimitedModels.clear()
  requestModelUsage.clear()
}

/**
 * Force refresh the free models cache
 */
export async function refreshFreeModelsCache(): Promise<string[]> {
  cachedFreeModels = []
  cacheTimestamp = 0
  return getFreeModels()
}
