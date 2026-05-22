"use client"

/**
 * Local-storage backed onboarding preferences for the storefront chat
 * concierge.
 *
 * Captured the first time a customer opens the chat (colors, materials,
 * fit/size, price range), persisted client-side, and shipped to the
 * backend on every chat turn so the system prompt can personalise
 * responses. A future iteration will mirror this server-side
 * (Phase 2 — `chat_threads` module) and merge on customer sign-in.
 *
 * Versioning matches `ai-chat-thread.ts`: bump `__v` to invalidate
 * stored data — corrupt / old-version entries are dropped silently
 * rather than migrated, which is fine for a small preference object.
 */

const STORAGE_KEY = "jyt:store:ai-chat-prefs-v1"
const CURRENT_VERSION = 1 as const

export type ChatFit = "relaxed" | "fitted"

export type AiChatPreferences = {
  __v?: typeof CURRENT_VERSION
  colors?: string[]
  styles?: string[]
  materials?: string[]
  price_range?: { min?: number; max?: number }
  body?: { size?: string; fit?: ChatFit }
  notes?: string
  /** Set once the customer has completed (or skipped) the onboarding. */
  onboarded?: boolean
  updated_at?: number
}

const isBrowser = typeof window !== "undefined"

export const loadPreferences = (): AiChatPreferences => {
  if (!isBrowser) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as any).__v !== CURRENT_VERSION
    ) {
      return {}
    }
    return parsed as AiChatPreferences
  } catch {
    return {}
  }
}

export const savePreferences = (prefs: AiChatPreferences): void => {
  if (!isBrowser) return
  try {
    const payload: AiChatPreferences = {
      ...prefs,
      __v: CURRENT_VERSION,
      updated_at: Date.now(),
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // best-effort — storage quota / private mode
  }
}

export const clearPreferences = (): void => {
  if (!isBrowser) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // best-effort
  }
}

/**
 * Strip the local-only fields (`__v`, `updated_at`, `onboarded`) before
 * sending to the backend. The wire shape is just the data the agent
 * needs to personalise its responses.
 */
export const toWireFormat = (prefs: AiChatPreferences) => {
  const { __v: _v, updated_at: _u, onboarded: _o, ...wire } = prefs
  return wire
}
