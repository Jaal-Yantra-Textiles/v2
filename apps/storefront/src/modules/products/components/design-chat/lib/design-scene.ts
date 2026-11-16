"use client"

import { sdk } from "@lib/config"
import { normalizeScene, type CanvasScene } from "../components/scene-panel"
import { designTokenHeaders, toDesignRequestError } from "./design-access"

/**
 * Board loader — reads the design's moodboard scene + thumbnail after a
 * generation, without a full page navigation.
 *
 * ## 🔴 Why this does not use `/store/custom/designs/:id`
 *
 * It used to, and that route requires an authenticated CUSTOMER. This flow's
 * entire premise is a guest identified by an email, so every call answered
 * `401 Customer authentication required` — swallowed by the `catch` below,
 * which the old comment described as "best-effort" on the theory that "the
 * board refreshes from the generation tool results in the chat itself".
 *
 * There is no such path. `refreshScene` is the ONLY thing that fills the board
 * after a generation. So the panel sat on "Your board is empty" for every
 * maker, forever, while the chat rendered both takes a few pixels to its left
 * — and nothing anywhere failed loudly enough to notice. Fifteen backend tests
 * pass either way; the only instrument that sees it is a rendered page.
 *
 * The read goes through the assistant's own mount, which (#2543) is gated on
 * the design token this browser was given when the design was made — not on
 * an email, which anyone can type.
 *
 * Throws a `DesignRequestError` with maker-ready copy so the caller can show
 * WHY the board did not refresh (403: another session's design; 429: slow
 * down) instead of a silent stale board.
 */
export const getDesignScene = async (
  designId: string,
  designToken?: string | null
): Promise<{
  design_id: string
  thumbnail_url: string | null
  scene: CanvasScene | null
}> => {
  try {
    const data = await sdk.client.fetch<{
      design: {
        id: string
        thumbnail_url?: string | null
        moodboard?: unknown
      }
    }>(`/store/custom/design-assistant/designs/${designId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...designTokenHeaders(designToken),
      },
    })
    const design = data.design
    return {
      design_id: design.id,
      thumbnail_url: design.thumbnail_url ?? null,
      scene: normalizeScene(design.moodboard),
    }
  } catch (error) {
    throw toDesignRequestError(error, "Couldn't refresh your board.")
  }
}
