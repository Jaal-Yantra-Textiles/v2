"use client"

import { sdk } from "@lib/config"

import { conversationTokenHeaders, designTokenHeaders } from "./design-access"

/**
 * Client for the server-backed design conversation store
 * (`/store/custom/design-assistant/conversations`).
 *
 * #2543: threads are NOT email-scoped any more. Creating one returns a
 * conversation token, kept in the local thread; every later read/write
 * presents it (`x-conversation-token`). Linking a design to a thread also
 * presents that design's token. A signed-in maker's list is read server-side
 * (`@lib/data/design-conversations`) because it needs the session cookie.
 *
 * The localStorage thread is the primary store, the server mirror is the
 * durable backstop — but a failed mirror is now REPORTED (not swallowed) so
 * the chat can say the thread did not save.
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
const headers = (extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  ...extra,
})

/** Fetch one thread with its full message array (needs its token). */
export const getDesignConversation = async (
  conversationId: string,
  conversationToken: string
): Promise<DesignConversation | null> => {
  try {
    const data = await sdk.client.fetch<{ conversation: DesignConversation }>(
      `/store/custom/design-assistant/conversations/${conversationId}`,
      {
        method: "GET",
        headers: headers(conversationTokenHeaders(conversationToken)),
      }
    )
    return data.conversation ?? null
  } catch {
    return null
  }
}

export type MirrorInput = {
  conversationId?: string
  conversationToken?: string
  designToken?: string
  customer_email: string
  thread_key: string
  title?: string
  design_id?: string
  messages: StoredUIMessage[]
}

export type MirrorResult =
  | { ok: true; conversationId: string; conversationToken: string }
  | { ok: false; status?: number }

/**
 * Mirror a thread to the server: create once (receiving the token), update
 * after. A thread held without a token (saved before #2543) is re-created
 * rather than written blind — the old row is unreachable without one.
 */
export const mirrorDesignThread = async (
  input: MirrorInput
): Promise<MirrorResult> => {
  const body = {
    customer_email: input.customer_email,
    thread_key: input.thread_key,
    title: input.title,
    design_id: input.design_id,
    messages: input.messages,
  }
  const designHeaders = input.design_id ? designTokenHeaders(input.designToken) : {}

  try {
    if (input.conversationId && input.conversationToken) {
      await sdk.client.fetch(
        `/store/custom/design-assistant/conversations/${input.conversationId}`,
        {
          method: "PATCH",
          body,
          headers: headers({
            ...conversationTokenHeaders(input.conversationToken),
            ...designHeaders,
          }),
        }
      )
      return {
        ok: true,
        conversationId: input.conversationId,
        conversationToken: input.conversationToken,
      }
    }

    const data = await sdk.client.fetch<{
      conversation: DesignConversation
      conversation_token: string
    }>(`/store/custom/design-assistant/conversations`, {
      method: "POST",
      body,
      headers: headers(designHeaders),
    })
    if (!data?.conversation?.id || !data.conversation_token) return { ok: false }
    return {
      ok: true,
      conversationId: data.conversation.id,
      conversationToken: data.conversation_token,
    }
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    return { ok: false, status: typeof status === "number" ? status : undefined }
  }
}

export const deleteDesignConversation = async (
  conversationId: string,
  conversationToken: string
): Promise<boolean> => {
  try {
    await sdk.client.fetch(
      `/store/custom/design-assistant/conversations/${conversationId}`,
      {
        method: "DELETE",
        body: {},
        headers: headers(conversationTokenHeaders(conversationToken)),
      }
    )
    return true
  } catch {
    return false
  }
}
