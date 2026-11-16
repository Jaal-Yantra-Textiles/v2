"use server"

import { sdk } from "@lib/config"

import { getAuthHeaders } from "./cookies"

/**
 * The SIGNED-IN maker's server-side design threads (#2543).
 *
 * The conversation list answers only to a customer session — an email alone
 * reads nothing — and the session cookie is httpOnly, so the list has to be
 * read here, server-side, with the auth header. Each row carries the
 * conversation token (and the design token when the session owns the design)
 * the browser then uses for every later call on that thread.
 *
 * Guests get an empty list; their threads live in localStorage with tokens.
 */
export type MyDesignConversation = {
  id: string
  title: string
  design_id: string | null
  conversation_token: string
  design_token: string | null
  updated_at?: string
}

export const listMyDesignConversations = async (
  threadKey: string
): Promise<MyDesignConversation[]> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) return []

  try {
    const data = await sdk.client.fetch<{
      conversations: MyDesignConversation[]
    }>(`/store/custom/design-assistant/conversations`, {
      method: "GET",
      query: { thread_key: threadKey },
      headers: { ...authHeaders },
      cache: "no-store",
    })
    return data.conversations ?? []
  } catch {
    return []
  }
}
