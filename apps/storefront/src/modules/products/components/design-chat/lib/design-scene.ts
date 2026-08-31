"use client"

import { sdk } from "@lib/config"
import { loadDesignerEmail } from "@lib/util/designer-email"
import { normalizeScene, type CanvasScene } from "../components/scene-panel"

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
 * The read now goes through the assistant's own email-scoped mount, which is
 * the auth model the rest of this feature already uses.
 *
 * ⚠️ Still `catch`-to-null, deliberately: a board that cannot refresh must not
 * take the chat down with it. But a null now means a real failure rather than
 * the design of the thing.
 */
export const getDesignScene = async (
  designId: string,
  /** The maker's email. Falls back to the remembered one. */
  customerEmail?: string | null
): Promise<{
  design_id: string
  thumbnail_url: string | null
  scene: CanvasScene | null
} | null> => {
  const email = (customerEmail || loadDesignerEmail() || "").trim()
  // Without an email the read cannot be scoped, and an unscoped board read is
  // not something to fall back to.
  if (!email) return null

  try {
    const data = await sdk.client.fetch<{
      design: {
        id: string
        thumbnail_url?: string | null
        moodboard?: unknown
      }
    }>(`/store/custom/design-assistant/designs/${designId}`, {
      method: "GET",
      query: { customer_email: email },
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
