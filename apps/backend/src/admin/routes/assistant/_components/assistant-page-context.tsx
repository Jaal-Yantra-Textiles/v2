/**
 * Shared state between the assistant page and its route modals.
 *
 * History and the media picker live on child routes (`@history`, `@media`) so
 * they render as `RouteFocusModal`s over the chat — which keeps the thread
 * (and `useChat`) mounted while they are open. The `@`-prefixed segments are
 * registered as children of `/assistant`, so both modals render inside this
 * page's `<Outlet />` and share its React tree — this context is the bridge
 * they use to act on the page's state: attachments for the media picker,
 * conversation actions for the history list.
 */
import { createContext, useContext } from "react"
import { API_BASE_URL } from "../../../lib/config"

/** An image the operator attached to the next message — uploaded or from the media library. */
export type AssistantAttachment = {
  url: string
  name: string
  mime_type: string
}

export type ConversationSummary = {
  id: string
  title: string
  created_at?: string
  updated_at?: string
}

export type StoredMessage = { id: string; role: string; parts: any[] }

/**
 * Matches the server validator (`attachments` on POST /admin/assistant/chat)
 * and the `useChat` files part — see the composer in page.tsx.
 */
export const MAX_ATTACHMENTS = 4

export const CONVERSATIONS_URL = `${API_BASE_URL.replace(/\/$/, "")}/admin/assistant/conversations`

/** Admin session cookie authenticates; small typed fetch wrapper. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export type AssistantPageContextValue = {
  // ── Attachments shared between the composer and the media picker ──
  attachments: AssistantAttachment[]
  addAttachments: (files: AssistantAttachment[]) => void
  removeAttachment: (url: string) => void
  clearAttachments: () => void
  maxAttachments: number

  // ── Conversation actions, used by the history route modal ──
  activeId: string | null
  openConversation: (id: string) => void
  /** Rejects after toasting, so a caller can undo an optimistic removal. */
  deleteConversation: (id: string) => Promise<void>
  startNew: () => void
}

export const AssistantPageContext = createContext<AssistantPageContextValue | null>(null)

export const useAssistantPage = (): AssistantPageContextValue => {
  const ctx = useContext(AssistantPageContext)
  if (!ctx) {
    throw new Error("useAssistantPage must be used within the assistant page")
  }
  return ctx
}
