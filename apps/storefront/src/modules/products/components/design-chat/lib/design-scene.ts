"use client"

import { sdk } from "@lib/config"
import { normalizeScene, type CanvasScene } from "../components/scene-panel"

/**
 * Light design state loader — refreshes the board after a generation without
 * a full page navigation. Reads the design's moodboard scene + thumbnail.
 *
 * The store designs API returns the design for the authenticated customer; a
 * guest customer (email-gated flow) reads via the same route after sign-in —
 * until then the board refreshes from the generation tool results in the chat
 * itself, so failures here are silent (best-effort).
 */
export const getDesignScene = async (
  designId: string
): Promise<{
  design_id: string
  thumbnail_url: string | null
  scene: CanvasScene | null
} | null> => {
  try {
    const data = await sdk.client.fetch<{
      design: {
        id: string
        thumbnail_url?: string | null
        moodboard?: unknown
      }
    }>(`/store/custom/designs/${designId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    const design = data.design
    return {
      design_id: design.id,
      thumbnail_url: design.thumbnail_url ?? null,
      scene: normalizeScene(design.moodboard),
    }
  } catch {
    return null
  }
}
