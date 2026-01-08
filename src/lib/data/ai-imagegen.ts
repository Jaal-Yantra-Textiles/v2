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

    console.error("Error generating AI image:", error)
    throw error
  }
}

