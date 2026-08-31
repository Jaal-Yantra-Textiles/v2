"use client"

/**
 * Designer email — the maker's email, remembered across design threads.
 *
 * The design chat creates a guest customer keyed on email the first time the
 * maker generates. We remember it globally (not per-thread) so starting a NEW
 * design never re-asks for the email — the onboarding only asks for the
 * garment type once an email is on file. Signed-in customers seed their email
 * server-side (retrieveCustomerFresh) and this store acts as the backstop for
 * anonymous makers.
 */

const STORAGE_KEY = "jyt:store:designer-email-v1"

const isBrowser = typeof window !== "undefined"

export const loadDesignerEmail = (): string | null => {
  if (!isBrowser) return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export const saveDesignerEmail = (email: string): void => {
  if (!isBrowser) return
  try {
    const normalized = email.trim().toLowerCase()
    if (normalized) window.localStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    // best-effort — storage quota / private mode
  }
}