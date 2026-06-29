"use client"

import type { UIMessage } from "ai"

/**
 * Local-storage persistence for the Cici concierge chat (the
 * `useChat`-driven experience now living at `/[countryCode]/chat`).
 *
 * Distinct from `ai-chat-thread.ts`, which stores the OLD `/store`
 * inline `ai-search` results (a different message shape). Here we
 * persist the AI-SDK `UIMessage[]` verbatim so a returning visitor can
 * resume the same conversation — including streamed product-card tool
 * outputs — and so the floating launcher can show an "active thread"
 * dot without re-fetching anything.
 *
 * Versioned via `__v`: wrong/corrupt shapes are dropped (fresh start)
 * rather than surfaced to the renderer.
 */

const STORAGE_KEY = "jyt:store:concierge-thread-v1"
const CURRENT_VERSION = 1 as const
const MAX_MESSAGES = 40 // bound the thread — oldest turns drop from the head

/** Window event fired on every save/clear so the launcher can re-read. */
export const CONCIERGE_THREAD_EVENT = "jyt:concierge-thread-change"

type StoredThread = {
  __v: typeof CURRENT_VERSION
  messages: UIMessage[]
  updated_at: number
}

const isBrowser = typeof window !== "undefined"

const notifyChange = () => {
  if (!isBrowser) return
  try {
    window.dispatchEvent(new Event(CONCIERGE_THREAD_EVENT))
  } catch {
    // best-effort — old browsers without the Event constructor
  }
}

export const loadConciergeMessages = (): UIMessage[] => {
  if (!isBrowser) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as any).__v !== CURRENT_VERSION ||
      !Array.isArray((parsed as any).messages)
    ) {
      return []
    }
    return (parsed as StoredThread).messages
  } catch {
    return []
  }
}

export const saveConciergeMessages = (messages: UIMessage[]): void => {
  if (!isBrowser) return
  try {
    if (!messages.length) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      const thread: StoredThread = {
        __v: CURRENT_VERSION,
        messages: messages.slice(-MAX_MESSAGES),
        updated_at: Date.now(),
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(thread))
    }
  } catch {
    // best-effort — quota exceeded or storage disabled
  }
  notifyChange()
}

export const clearConciergeThread = (): void => {
  if (!isBrowser) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best-effort
  }
  notifyChange()
}

/** Cheap check (no JSON parse of the full payload) for the launcher dot. */
export const hasConciergeThread = (): boolean => {
  if (!isBrowser) return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) != null
  } catch {
    return false
  }
}
