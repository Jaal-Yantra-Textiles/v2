"use client"

import { sdk } from "@lib/config"

/**
 * Deterministic canvas pick — calls the backend pick API directly (no model
 * turn). The same write `set_active_canvas` performs when the maker says
 * "pick take B" in chat: marks the canvas active in the Excalidraw scene and
 * stamps design.thumbnail_url.
 */
export const pickDesignCanvas = async (
  designId: string,
  canvasId: string
): Promise<{ ok: boolean; thumbnail_url: string | null }> => {
  const data = await sdk.client.fetch<{
    ok: boolean
    thumbnail_url: string | null
  }>(`/store/custom/design-assistant/pick`, {
    method: "POST",
    body: { design_id: designId, canvas_id: canvasId },
    headers: { "Content-Type": "application/json" },
  })
  return data
}
