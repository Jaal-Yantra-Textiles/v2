"use client"

import type {
  AiSearchProduct,
  AiSearchResponse,
} from "@lib/data/ai-search"

/**
 * Local-storage backed conversation thread for the storefront AI search.
 *
 * Persists across page reloads so a customer's session keeps its
 * context. A future iteration will sync the thread to the backend
 * (`/store/ai/search/thread`) when a customer signs in — for now the
 * thread is browser-local and bounded to the device.
 *
 * Storage format is versioned via `__v` so we can migrate forward
 * without nuking history. Bumping `__v` here without writing a
 * migration is intentional: corrupt / wrong-version data is dropped
 * and the user starts fresh, which is preferable to surfacing stale
 * shape to the renderer.
 */

const STORAGE_KEY = "jyt:store:ai-chat-thread-v1"
const CURRENT_VERSION = 1 as const
const MAX_MESSAGES = 40 // keep the thread bounded — older turns dropped from the head

export type AiChatRole = "user" | "assistant"

export type AiChatMessage = {
  id: string
  role: AiChatRole
  content: string
  ts: number
  // Only present on assistant messages.
  products?: AiSearchProduct[]
  interpretation?: AiSearchResponse["interpretation"]
  mode?: AiSearchResponse["mode"]
  count?: number
  // True if the AI call errored and we rendered a graceful failure card.
  failed?: boolean
}

export type AiChatThread = {
  __v: typeof CURRENT_VERSION
  messages: AiChatMessage[]
  updated_at: number
}

const isBrowser = typeof window !== "undefined"

export const loadThread = (): AiChatThread => {
  if (!isBrowser) return emptyThread()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyThread()
    const parsed = JSON.parse(raw) as unknown
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as any).__v !== CURRENT_VERSION ||
      !Array.isArray((parsed as any).messages)
    ) {
      return emptyThread()
    }
    return parsed as AiChatThread
  } catch {
    return emptyThread()
  }
}

export const saveThread = (thread: AiChatThread): void => {
  if (!isBrowser) return
  try {
    const trimmed: AiChatThread = {
      ...thread,
      messages: thread.messages.slice(-MAX_MESSAGES),
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // best-effort — quota exceeded or storage disabled
  }
}

export const clearThread = (): void => {
  if (!isBrowser) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best-effort
  }
}

export const emptyThread = (): AiChatThread => ({
  __v: CURRENT_VERSION,
  messages: [],
  updated_at: Date.now(),
})

/**
 * `crypto.randomUUID` is available in all modern browsers + Node 19+.
 * Fall back to a Math.random-based id for ancient environments so the
 * UI never crashes on a missing API.
 */
export const newMessageId = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }
}
