import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import {
  clearPartnerSession,
  getLastRefreshAt,
  refreshPartnerSession,
} from "./client/session-refresh"

export const MEDUSA_BACKEND_URL = __BACKEND_URL__ ?? "/"

/**
 * A 401 this soon after a successful refresh is not an expired token — the new
 * one is seconds old. Don't spin refreshing for it; only a refused renewal
 * ever signs a partner out.
 */
const FRESH_TOKEN_GRACE_MS = 10 * 1000

const isUnauthorized = (error: unknown): boolean =>
  (error as any)?.status === 401

/** Sign out locally and land on the login page with the reason. */
export const endPartnerSession = () => {
  clearPartnerSession()
  queryClient.clear()
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login?session_expired=1")
  }
}

/**
 * A request came back 401: renew the token once and refetch, or end the session
 * when the server refuses the renewal. A network error or 5xx on the renewal
 * keeps the partner signed in — only a refusal signs them out.
 */
const handleUnauthorized = async () => {
  if (Date.now() - getLastRefreshAt() < FRESH_TOKEN_GRACE_MS) {
    return
  }
  const outcome = await refreshPartnerSession()
  if (outcome === "refreshed") {
    await queryClient.invalidateQueries()
  } else if (outcome === "rejected") {
    endPartnerSession()
  }
  // "no-token": a login form's own 401 (wrong password) — nothing to renew.
  // "failed": leave the session alone; the next request tries again.
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorized(error)) {
        void handleUnauthorized()
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorized(error)) {
        void handleUnauthorized()
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 90000,
      // Never retry a 401 with the same token — the cache handler renews it.
      retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 1,
    },
  },
})
