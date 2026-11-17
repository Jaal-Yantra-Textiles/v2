"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"

/**
 * The signed-in buyer's open studio design (or a new empty one) and its
 * access token (#2543 phase 2).
 *
 * Reference photos upload straight from the browser, which cannot carry the
 * httpOnly session — so when photos arrive before the chat has made a design,
 * this server action (which CAN read the session) resolves the design first
 * and the browser uploads onto it with the token. Null for a guest: they
 * verify their email first.
 */
export async function ensureStudioDesign(): Promise<{
  design_id: string
  design_token: string
} | null> {
  const headers = await getAuthHeaders()
  if (!headers || !("authorization" in headers)) return null
  try {
    const res = await sdk.client.fetch<{ design_id: string; design_token: string }>(
      "/store/custom/design-assistant/designs",
      { method: "POST", body: {}, headers: { ...headers }, cache: "no-store" }
    )
    return res?.design_id && res?.design_token
      ? { design_id: res.design_id, design_token: res.design_token }
      : null
  } catch {
    return null
  }
}
