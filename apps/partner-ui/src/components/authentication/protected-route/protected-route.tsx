import { Spinner } from "@medusajs/icons"
import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { backendUrl } from "../../../lib/client/client"
import { useMe } from "../../../hooks/api/users"
import { queryClient } from "../../../lib/query-client"
import { SearchProvider } from "../../../providers/search-provider/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"

function stripQueryParam(search: string, param: string): string {
  if (!search) return search
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  if (!params.has(param)) return search
  params.delete(param)
  const next = params.toString()
  return next ? `?${next}` : ""
}

// Must match the SDK's jwtTokenStorageKey in lib/client/client.ts. The
// Medusa SDK reads its bearer token from this localStorage key on every
// request, so writing it here gives us an authenticated session as soon
// as we strip the wa_token from the URL.
const JWT_TOKEN_STORAGE_KEY =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof __JWT_TOKEN_STORAGE_KEY__ !== "undefined" && __JWT_TOKEN_STORAGE_KEY__) ||
  "partner_ui_auth_token"

type WaAuthResponse = {
  token: string
  partner_id: string
  partner_name?: string
  redirect: string
  type: string
  run_id: string | null
}

type WaExchangeOutcome =
  | { ok: true; redirect: string }
  | { ok: false; message: string }

/**
 * Exchange a WhatsApp deep-link token for a Medusa partner session bearer.
 * Stores the bearer in localStorage (same key the SDK reads from) so
 * subsequent useMe() / useQuery() calls are authenticated.
 *
 * On failure, returns the server's error message verbatim — the
 * /partners/wa-auth route maps each verification failure (expired /
 * invalid signature / wrong issuer / malformed) to a distinct
 * user-facing string. We surface that on the login page so the user
 * knows whether to wait for a new reminder or flag a backend issue.
 */
async function exchangeWaToken(waToken: string): Promise<WaExchangeOutcome> {
  try {
    const url = new URL(`${backendUrl.replace(/\/$/, "")}/partners/wa-auth`)
    url.searchParams.set("wa_token", waToken)
    const resp = await fetch(url.toString(), { credentials: "include" })
    if (!resp.ok) {
      // Try to read the structured Medusa error message; fall back to
      // a generic phrase if the response isn't JSON or the field is
      // missing.
      let message = "We couldn't verify your link. Please request a new one."
      try {
        const body = (await resp.json()) as { message?: string }
        if (body?.message) message = body.message
      } catch {
        // not JSON — keep the default
      }
      return { ok: false, message }
    }
    const data = (await resp.json()) as WaAuthResponse
    if (!data?.token) {
      return {
        ok: false,
        message:
          "Server didn't return a session token. Please request a new link via WhatsApp.",
      }
    }
    window.localStorage.setItem(JWT_TOKEN_STORAGE_KEY, data.token)
    return { ok: true, redirect: data.redirect || "/" }
  } catch (err: any) {
    return {
      ok: false,
      message:
        "Couldn't reach the server to verify your link. Check your connection and try again.",
    }
  }
}

export const ProtectedRoute = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const waToken = params.get("wa_token")

  // While exchanging a wa_token we hold the auth check open so the
  // ProtectedRoute doesn't flicker through the /login redirect on the
  // first paint. State is null when there's nothing to exchange.
  const [waExchangeState, setWaExchangeState] = useState<
    "pending" | "done" | "failed" | null
  >(waToken ? "pending" : null)
  const [waExchangeError, setWaExchangeError] = useState<string | null>(null)

  useEffect(() => {
    if (!waToken) return
    let cancelled = false
    ;(async () => {
      const outcome = await exchangeWaToken(waToken)
      if (cancelled) return
      if (outcome.ok) {
        // Strip the wa_token from the URL so it doesn't leak via shares
        // and so a refresh doesn't re-run the exchange. Use replace so
        // the back button doesn't return to the token URL.
        // useMe() is invalidated to pick up the new bearer.
        queryClient.invalidateQueries({ queryKey: ["users", "me"] })
        setWaExchangeState("done")
        navigate(outcome.redirect, { replace: true })
      } else {
        setWaExchangeError(outcome.message)
        setWaExchangeState("failed")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [waToken, navigate])

  const { user, isLoading } = useMe({
    // Skip the `me` query while we're still exchanging the wa_token —
    // it would 401 on the first paint and trigger the login redirect.
    enabled: waExchangeState !== "pending",
  })

  if (waExchangeState === "pending" || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  if (!user) {
    // Forward the wa-auth failure message (if any) to the login page
    // so the user sees why their deep-link didn't work, instead of a
    // bare login screen. The login page reads `state.waAuthError`.
    const fromLocation = waToken
      ? // Strip the wa_token from the preserved location so retrying a
        // login doesn't try to re-exchange the (still-bad) token.
        { ...location, search: stripQueryParam(location.search, "wa_token") }
      : location
    return (
      <Navigate
        to="/login"
        state={{
          from: fromLocation,
          waAuthError: waExchangeError ?? undefined,
        }}
        replace
      />
    )
  }

  return (
    <SidebarProvider>
      <SearchProvider>
        <Outlet />
      </SearchProvider>
    </SidebarProvider>
  )
}

