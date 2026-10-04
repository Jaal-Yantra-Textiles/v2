import { backendUrl, jwtTokenStorageKey } from "./client"

/**
 * Keeps a partner signed in past the 1-day JWT lifetime.
 *
 * `POST /partners/auth/refresh` swaps the stored bearer — even one that expired
 * up to 30 days ago — for a fresh one. Nothing else in the portal renewed the
 * token, so every partner was signed out a day after logging in.
 *
 * Plain fetch, not `sdk.client.fetch`: the SDK would attach the same stale
 * bearer through its own error handling, and this call must never recurse into
 * the 401 handler that invokes it.
 */

export type RefreshOutcome =
  /** A new token is stored. */
  | "refreshed"
  /** The server refused the token (401): the session is over. */
  | "rejected"
  /** Network error, 5xx, or a route that isn't deployed yet: keep the token. */
  | "failed"
  /** Nothing stored — not signed in. */
  | "no-token"

const LAST_REFRESH_KEY = "partner_ui_last_refresh"

/** Renew on tab focus once the token is this old. JWTs live a day. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Storage blocked (private mode): the session just won't persist.
  }
}

export const getLastRefreshAt = (): number => Number(read(LAST_REFRESH_KEY)) || 0

/** Record a freshly issued token (login or refresh). */
export const markSessionRefreshed = () => write(LAST_REFRESH_KEY, String(Date.now()))

export const isRefreshDue = (): boolean =>
  Date.now() - getLastRefreshAt() > REFRESH_INTERVAL_MS

/** Forget the session locally. */
export const clearPartnerSession = () => {
  write(jwtTokenStorageKey, null)
  write(LAST_REFRESH_KEY, null)
}

let inFlight: Promise<RefreshOutcome> | null = null

/**
 * Renew the stored token. Concurrent callers share one request, so a burst of
 * 401s spends the old token once.
 */
export const refreshPartnerSession = (): Promise<RefreshOutcome> => {
  if (inFlight) {
    return inFlight
  }
  const token = read(jwtTokenStorageKey)
  if (!token) {
    return Promise.resolve("no-token")
  }

  inFlight = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, "")}/partners/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        return "rejected"
      }
      if (!res.ok) {
        return "failed"
      }
      const data = await res.json().catch(() => null)
      const fresh = typeof data?.token === "string" ? data.token : null
      if (!fresh) {
        return "failed"
      }
      write(jwtTokenStorageKey, fresh)
      markSessionRefreshed()
      return "refreshed"
    } catch {
      return "failed"
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
