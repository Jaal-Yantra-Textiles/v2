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
 * @returns Generated image URL and metadata
 * @throws Error if not authenticated or generation fails
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
    throw new Error("AUTH_REQUIRED")
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
    // Handle specific error types
    if (error?.status === 401 || error?.message?.includes("unauthorized")) {
      throw new Error("AUTH_REQUIRED")
    }

    if (error?.status === 429) {
      throw new Error("QUOTA_EXCEEDED")
    }

    // Handle OUT_OF_CREDITS error from multi-provider system
    // This is returned when all AI providers have hit their rate limits
    if (
      error?.message?.includes("OUT_OF_CREDITS") ||
      error?.body?.message?.includes("OUT_OF_CREDITS")
    ) {
      throw new Error("OUT_OF_CREDITS")
    }

    console.error("Error generating AI image:", error)
    throw error
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
    console.error("Error fetching AI generation history:", error)
    return []
  }
}

