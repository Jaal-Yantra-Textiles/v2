import { Spinner } from "@medusajs/icons"
import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { backendUrl } from "../../../lib/client/client"
import { useMe } from "../../../hooks/api/users"
import { queryClient } from "../../../lib/query-client"
import { SearchProvider } from "../../../providers/search-provider/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"

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

/**
 * Exchange a WhatsApp deep-link token for a Medusa partner session bearer.
 * Stores the bearer in localStorage (same key the SDK reads from) so
 * subsequent useMe() / useQuery() calls are authenticated.
 *
 * Returns the redirect path on success, or null on failure (caller falls
 * through to the normal /login redirect).
 */
async function exchangeWaToken(waToken: string): Promise<string | null> {
  try {
    const url = new URL(`${backendUrl.replace(/\/$/, "")}/partners/wa-auth`)
    url.searchParams.set("wa_token", waToken)
    const resp = await fetch(url.toString(), { credentials: "include" })
    if (!resp.ok) return null
    const data = (await resp.json()) as WaAuthResponse
    if (!data?.token) return null
    window.localStorage.setItem(JWT_TOKEN_STORAGE_KEY, data.token)
    return data.redirect || "/"
  } catch {
    return null
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

  useEffect(() => {
    if (!waToken) return
    let cancelled = false
    ;(async () => {
      const redirect = await exchangeWaToken(waToken)
      if (cancelled) return
      if (redirect) {
        // Strip the wa_token from the URL so it doesn't leak via shares
        // and so a refresh doesn't re-run the exchange. Use replace so
        // the back button doesn't return to the token URL.
        // useMe() is invalidated to pick up the new bearer.
        queryClient.invalidateQueries({ queryKey: ["users", "me"] })
        setWaExchangeState("done")
        navigate(redirect, { replace: true })
      } else {
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
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return (
    <SidebarProvider>
      <SearchProvider>
        <Outlet />
      </SearchProvider>
    </SidebarProvider>
  )
}

