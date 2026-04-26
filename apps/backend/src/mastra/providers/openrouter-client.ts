/**
 * OpenRouter Client
 *
 * Creates an OpenAI-compatible client configured to use OpenRouter's API.
 * Uses the AI SDK's createOpenAI function with OpenRouter's base URL.
 */

import { createOpenAI } from "@ai-sdk/openai"

export interface OpenRouterClientOptions {
  apiKey?: string
  appUrl?: string
  appTitle?: string
}

/**
 * Create an OpenRouter client using the AI SDK
 *
 * This client is OpenAI-compatible and can be used with the AI SDK's
 * generateText, streamText, etc. functions.
 */
export function createOpenRouterClient(options?: OpenRouterClientOptions) {
  const apiKey = options?.apiKey || process.env.OPENROUTER_API_KEY
  const appUrl = options?.appUrl || process.env.APP_URL || process.env.MEDUSA_BACKEND_URL
  const appTitle = options?.appTitle || "JYT Admin AI"

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or pass apiKey option."
    )
  }

  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      ...(appUrl ? { "HTTP-Referer": appUrl } : {}),
      "X-Title": appTitle,
    },
  })
}

/**
 * Get a model instance from the OpenRouter client
 *
 * @param modelId - The OpenRouter model ID (e.g., "google/gemini-2.0-flash-exp:free")
 * @param options - Optional client configuration
 */
export function getOpenRouterModel(modelId: string, options?: OpenRouterClientOptions) {
  const client = createOpenRouterClient(options)
  return client(modelId)
}

/**
 * Check if OpenRouter is configured
 */
export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}
