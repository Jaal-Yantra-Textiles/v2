"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"

// Badge preferences for AI generation
export type AiBadges = {
  style?: string
  color_family?: string
  body_type?: string
  embellishment_level?: string
  occasion?: string
  budget_sensitivity?: string
  custom?: Record<string, any>
}

// Reference image for AI generation
export type AiReferenceImage = {
  url: string
  weight?: number
  prompt?: string
}

// Canvas snapshot for context
export type AiCanvasSnapshot = {
  width: number
  height: number
  layers: Array<{
    id: string
    type: "image" | "text" | "shape"
    data: Record<string, any>
  }>
}

// Request input for AI image generation
export type GenerateAiImageInput = {
  design_id?: string
  mode: "preview" | "commit"
  badges?: AiBadges
  materials_prompt?: string
  reference_images?: AiReferenceImage[]
  canvas_snapshot?: AiCanvasSnapshot
  preview_cache_key?: string
}

// Response from AI image generation
export type GenerateAiImageResponse = {
  generation: {
    mode: "preview" | "commit"
    preview_url?: string
    media_id?: string
    prompt_used: string
    badges?: AiBadges
    materials_prompt?: string
    generated_at: string
    quota_remaining?: number
  }
  // Error field for structured error handling (avoids Next.js Server Action error suppression)
  error?: {
    code: "AUTH_REQUIRED" | "QUOTA_EXCEEDED" | "OUT_OF_CREDITS" | "PAYMENT_REQUIRED" | "UNKNOWN"
    message: string
  }
}

// Error response structure
export type AiImageGenError = {
  message: string
  code?: string
}

// AI generation history item from designs API
export type AiGenerationHistoryItem = {
  id: string
  preview_url: string
  prompt_used: string
  generated_at: string
  badges?: AiBadges
  materials_prompt?: string
}

// Response from AI history fetch
export type AiHistoryResponse = {
  designs: Array<{
    id: string
    name: string
    description: string
    thumbnail_url: string
    media_files?: Array<{ id?: string; url: string; isThumbnail?: boolean }>
    metadata?: {
      ai_generation?: {
        media_id?: string
        preview_url?: string
        badges?: AiBadges
        materials_prompt?: string
        prompt_used?: string
        generated_at?: string
      }
    }
    origin_source: string
    created_at: string
  }>
  count: number
  offset: number
  limit: number
}

/**
 * Generates an AI design image based on badges, materials, and references
 *
 * @param input - Generation parameters including mode, badges, and materials
 * @returns Generated image URL and metadata, or an error object
 *
 * NOTE: This function returns errors in the response object instead of throwing them.
 * This is because Next.js Server Actions suppress error messages in production for security,
 * which would prevent the client from detecting AUTH_REQUIRED errors to show the login modal.
 */
export const generateAiImage = async (
  input: GenerateAiImageInput
): Promise<GenerateAiImageResponse> => {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  }

  // Check if we have auth headers (user is logged in)
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    // Return error in response instead of throwing (Next.js suppresses thrown errors in production)
    return {
      generation: {
        mode: input.mode,
        prompt_used: "",
        generated_at: new Date().toISOString(),
      },
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required to generate AI images",
      },
    }
  }

  try {
    const data = await sdk.client.fetch<GenerateAiImageResponse>(
      `/store/ai/imagegen`,
      {
        method: "POST",
        body: input,
        headers,
      }
    )

    return data
  } catch (error: any) {
    // Handle specific error types - return structured errors instead of throwing
    if (error?.status === 402) {
      return {
        generation: {
          mode: input.mode,
          prompt_used: "",
          generated_at: new Date().toISOString(),
        },
        error: {
          code: "PAYMENT_REQUIRED",
          message: "AI features require a one-time €2 verification fee",
        },
      }
    }

    if (error?.status === 401 || error?.message?.includes("unauthorized")) {
      return {
        generation: {
          mode: input.mode,
          prompt_used: "",
          generated_at: new Date().toISOString(),
        },
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required to generate AI images",
        },
      }
    }

    if (error?.status === 429) {
      return {
        generation: {
          mode: input.mode,
          prompt_used: "",
          generated_at: new Date().toISOString(),
        },
        error: {
          code: "QUOTA_EXCEEDED",
          message: "You've reached your daily AI generation limit. Try again tomorrow.",
        },
      }
    }

    // Handle OUT_OF_CREDITS error from multi-provider system
    // This is returned when all AI providers have hit their rate limits
    if (
      error?.message?.includes("OUT_OF_CREDITS") ||
      error?.body?.message?.includes("OUT_OF_CREDITS")
    ) {
      return {
        generation: {
          mode: input.mode,
          prompt_used: "",
          generated_at: new Date().toISOString(),
        },
        error: {
          code: "OUT_OF_CREDITS",
          message: "All AI providers are currently at capacity. Please try again in a few minutes.",
        },
      }
    }

    console.error("Error generating AI image:", error)

    // Return unknown error
    return {
      generation: {
        mode: input.mode,
        prompt_used: "",
        generated_at: new Date().toISOString(),
      },
      error: {
        code: "UNKNOWN",
        message: error?.message || "Failed to generate AI image. Please try again.",
      },
    }
  }
}

/**
 * Fetches AI generation history for the authenticated customer
 *
 * @param limit - Maximum number of items to return (default: 20)
 * @param offset - Pagination offset (default: 0)
 * @returns List of AI-generated designs with metadata
 */
export const fetchAiGenerationHistory = async (
  limit: number = 20,
  offset: number = 0
): Promise<AiGenerationHistoryItem[]> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  // Check if we have auth headers (user is logged in)
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    // Return empty array if not logged in
    return []
  }

  try {
    const data = await sdk.client.fetch<AiHistoryResponse>(
      `/store/custom/designs?include_ai=true&limit=${limit}&offset=${offset}`,
      {
        method: "GET",
        headers,
      }
    )

    // Transform designs to history items
    return (data.designs || []).map((design) => {
      const aiGeneration = design.metadata?.ai_generation
      const thumbnailMedia = design.media_files?.find((m) => m.isThumbnail)

      return {
        id: design.id,
        preview_url:
          aiGeneration?.preview_url ||
          thumbnailMedia?.url ||
          design.thumbnail_url ||
          "",
        prompt_used:
          aiGeneration?.prompt_used || design.description || "AI-generated design",
        generated_at: aiGeneration?.generated_at || design.created_at,
        badges: aiGeneration?.badges,
        materials_prompt: aiGeneration?.materials_prompt,
      }
    })
  } catch (error: any) {
    // 401 is expected when session is expired — don't log as error
    if (error?.status !== 401 && error?.status !== 403) {
      console.error("Error fetching AI generation history:", error)
    }
    return []
  }
}

