"use client"

/**
 * Visitor id — single source of truth for the storefront's anonymous
 * id. Same key as `localStorage["jyt_visitor_id"]` written by the
 * analytics snippet (analytics.min.js) and read by cart.ts /
 * product-actions / (soon) the chat modal.
 *
 * If the analytics snippet hasn't loaded yet we generate one locally
 * and persist it. That keeps the chat → cart → checkout funnel
 * joinable even when the analytics script is blocked or slow.
 */

const STORAGE_KEY = "jyt_visitor_id"
const isBrowser = typeof window !== "undefined"

const randomId = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `v_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  }
}

/**
 * Read the visitor id, generating + persisting one if it doesn't exist.
 * Returns null in non-browser environments (SSR) — callers should fall
 * back gracefully (the chat endpoint requires it on the wire).
 */
export const getOrCreateVisitorId = (): string | null => {
  if (!isBrowser) return null
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length > 0) return existing
    const fresh = randomId()
    window.localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Storage disabled (private mode, quota) — return a transient id
    // so the in-memory session at least has a stable handle. It won't
    // persist across reloads, but the chat still works.
    return randomId()
  }
}
