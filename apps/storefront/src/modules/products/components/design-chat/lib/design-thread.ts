"use client"

import type { UIMessage } from "ai"
import { sdk } from "@lib/config"

/**
 * Design thread persistence — the chat-based design editor's thread store.
 *
 * Threads are keyed per base product (the same scope the backend conversations
 * API uses as `thread_key`): `product:{id}` for product-variant designs,
 * `custom` for standalone designs at /design. Messages persist to localStorage
 * so a returning maker resumes their board instantly, and are mirrored to the
 * server-backed conversation store (email-scoped, see design-conversations.ts)
 * after each completed turn so threads survive localStorage clears and follow
 * the maker across devices.
 *
 * Mirrors the concierge-thread pattern (`@lib/util/concierge-thread`).
 */

const STORAGE_PREFIX = "jyt:design-thread:"

export type DesignThreadMeta = {
  /** Base-product scope key: `product:{id}` or `custom`. */
  threadKey: string
  /** The maker's email once shared (the flow's gate). */
  email?: string
  /** Backend conversation id once the thread is mirrored. */
  conversationId?: string
  /** Design id once first generation creates it. */
  designId?: string
  /** Human-readable label (seeded from the first user message). */
  title?: string
}

export type DesignThread = {
  meta: DesignThreadMeta
  messages: UIMessage[]
}

export const resolveThreadKey = (productId?: string | null): string =>
  productId ? `product:${productId}` : "custom"

export const loadDesignThread = (threadKey: string): DesignThread | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + threadKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return {
      meta: {
        threadKey,
        ...(parsed.meta ?? {}),
      },
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch {
    return null
  }
}

export const saveDesignThread = (thread: DesignThread): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + thread.meta.threadKey,
      JSON.stringify(thread)
    )
    window.dispatchEvent(new Event("jyt:design-thread-change"))
  } catch {
    // Storage full / private mode — the server mirror is the backstop.
  }
}

export const clearDesignThread = (threadKey: string): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + threadKey)
    window.dispatchEvent(new Event("jyt:design-thread-change"))
  } catch {
    /* ignore */
  }
}

export const hasDesignThread = (threadKey: string): boolean =>
  typeof window !== "undefined" &&
  Boolean(window.localStorage.getItem(STORAGE_PREFIX + threadKey))

/** All the maker's locally stored design threads (thread list). */
export const listLocalDesignThreads = (): DesignThreadMeta[] => {
  if (typeof window === "undefined") return []
  const metas: DesignThreadMeta[] = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        metas.push(parsed?.meta ?? { threadKey: key.slice(STORAGE_PREFIX.length) })
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    /* ignore */
  }
  return metas
}
