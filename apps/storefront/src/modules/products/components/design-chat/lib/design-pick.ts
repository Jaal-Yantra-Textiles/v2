"use client"

import { sdk } from "@lib/config"

import { designTokenHeaders, toDesignRequestError } from "./design-access"

/**
 * Deterministic canvas pick — calls the backend pick API directly (no model
 * turn). The same write `set_active_canvas` performs when the maker says
 * "pick take B" in chat: marks the canvas active in the Excalidraw scene and
 * stamps design.thumbnail_url.
 *
 * #2543: sends the design token; throws a `DesignRequestError` whose message
 * is ready to show the maker (403 / 429 / other).
 */
export const pickDesignCanvas = async (
  designId: string,
  canvasId: string,
  designToken?: string | null
): Promise<{ ok: boolean; thumbnail_url: string | null }> => {
  try {
    return await sdk.client.fetch<{
      ok: boolean
      thumbnail_url: string | null
    }>(`/store/custom/design-assistant/pick`, {
      method: "POST",
      body: { design_id: designId, canvas_id: canvasId },
      headers: {
        "Content-Type": "application/json",
        ...designTokenHeaders(designToken),
      },
    })
  } catch (error) {
    throw toDesignRequestError(error, "Couldn't save that pick — try again.")
  }
}
