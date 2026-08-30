"use client"

import { sdk } from "@lib/config"

/**
 * Client for the server-backed design conversation store
 * (`/store/custom/design-assistant/conversations`).
 *
 * The design chat is public and gated on the maker's EMAIL (no login — the
 * same gate the backend flow uses). Threads scope by normalised email +
 * thread key server-side; the client mirrors the localStorage design thread
 * here after each completed turn so threads survive storage clears and follow
 * the maker across devices.
 *
 * All calls return friendly nulls on failure — the localStorage thread is the
 * primary store, the server mirror is the durable backstop.
 */

export type StoredUIMessage = {
  id?: string
  role: "system" | "user" | "assistant"
  content?: string
  parts?: Array<{ type: string } & Record<string, any>>
}

export type DesignConversation = {
  id: string
  customer_email: string
  thread_key: string
  design_id: string | null
  title: string
  messages?: StoredUIMessage[]
  created_at?: string
  updated_at?: string
}

// The SDK is configured with the publishable key at construction and sends
// it on every fetch — /store/* public routes need nothing extra.
const headers = () => ({
  "Content-Type": "application/json",
})

/** List the maker's threads for one thread key (light — no bodies). */
export const listDesignConversations = async (
  email: string,
  threadKey: string
): Promise<DesignConversation[]> => {
  try {
    const data = await sdk.client.fetch<{ conversations: DesignConversation[] }>(
      `/store/custom/design-assistant/conversations`,
      {
        method: "GET",
        query: { customer_email: email, thread_key: threadKey, limit: 20 },
        headers: headers(),
      }
    )
    return data.conversations ?? []
  } catch {
    return []
  }
}

/** Fetch one thread with its full message array. */
export const getDesignConversation = async (
  email: string,
  threadKey: string,
  conversationId: string
): Promise<DesignConversation | null> => {
  try {
    const data = await sdk.client.fetch<{ conversation: DesignConversation }>(
      `/store/custom/design-assistant/conversations/${conversationId}`,
      {
        method: "GET",
        query: { customer_email: email, thread_key: threadKey },
        headers: headers(),
      }
    )
    return data.conversation ?? null
  } catch {
    return null
  }
}

/** Create the server mirror for a thread. */
export const createDesignConversation = async (
  input: {
    customer_email: string
    thread_key: string
    title?: string
    design_id?: string
    messages?: StoredUIMessage[]
  }
): Promise<DesignConversation | null> => {
  try {
    const data = await sdk.client.fetch<{ conversation: DesignConversation }>(
      `/store/custom/design-assistant/conversations`,
      {
        method: "POST",
        body: input,
        headers: headers(),
      }
    )
    return data.conversation ?? null
  } catch {
    return null
  }
}

/** Persist messages / title / design link after each completed turn. */
export const updateDesignConversation = async (
  conversationId: string,
  input: {
    customer_email: string
    thread_key: string
    title?: string
    design_id?: string
    messages?: StoredUIMessage[]
  }
): Promise<boolean> => {
  try {
    await sdk.client.fetch(
      `/store/custom/design-assistant/conversations/${conversationId}`,
      {
        method: "PATCH",
        body: input,
        headers: headers(),
      }
    )
    return true
  } catch {
    return false
  }
}

export const deleteDesignConversation = async (
  conversationId: string,
  email: string,
  threadKey: string
): Promise<boolean> => {
  try {
    await sdk.client.fetch(
      `/store/custom/design-assistant/conversations/${conversationId}`,
      {
        method: "DELETE",
        body: { customer_email: email, thread_key: threadKey },
        headers: headers(),
      }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Mirror a thread to the server: create once, update after. Returns the
 * conversation id (null on failure — the caller keeps the local thread).
 */
export const mirrorDesignThread = async (input: {
  conversationId?: string
  customer_email: string
  thread_key: string
  title?: string
  design_id?: string
  messages: StoredUIMessage[]
}): Promise<string | null> => {
  if (input.conversationId) {
    const ok = await updateDesignConversation(input.conversationId, input)
    return ok ? input.conversationId : null
  }
  const created = await createDesignConversation(input)
  return created?.id ?? null
}
