"use server"

import { sdk } from "@lib/config"

/**
 * Design reference analysis — on-the-fly vision read of an uploaded image.
 *
 * The client uploads a reference (presign → S3) and calls this immediately
 * after, so the image is described the moment it arrives (not deferred to a
 * later model tool call). The backend returns the analysis AND caches it on
 * the MediaFile record (`metadata.vision_analysis`), so subsequent turns and
 * tool calls reuse it without another vision round-trip.
 *
 * Best-effort: returns `{ analysis: null }` on failure so the upload flow
 * never blocks.
 */
export type ReferenceAnalysisResult = {
  title: string
  description: string
  suggestions: string[]
  media_id: string | null
  analyzed_at: string | null
  cached?: boolean
}

export const analyzeDesignReference = async (input: {
  url: string
  name?: string
  mime_type?: string
}): Promise<{ analysis: ReferenceAnalysisResult | null }> => {
  try {
    const data = await sdk.client.fetch<{
      analysis: ReferenceAnalysisResult | null
    }>(`/store/custom/design-assistant/references/analyze`, {
      method: "POST",
      body: {
        url: input.url,
        ...(input.name ? { name: input.name } : {}),
        ...(input.mime_type ? { mime_type: input.mime_type } : {}),
      },
      headers: { "Content-Type": "application/json" },
    })
    return { analysis: data.analysis ?? null }
  } catch (error) {
    console.error("Error analyzing design reference:", error)
    return { analysis: null }
  }
}