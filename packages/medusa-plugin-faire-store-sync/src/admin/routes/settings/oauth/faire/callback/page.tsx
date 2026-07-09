import { Container, Heading, Text, Alert, Button } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { faireApi } from "../../../../../lib/api"

/**
 * Faire redirects here with `?code=...&state=...`. Faire OAuth codes are
 * single-use: exchanging the same code twice yields `invalid_grant`.
 *
 * A `useRef` guard is not sufficient — React StrictMode (dev) simulates an
 * unmount/remount which resets the ref, and any real remount (e.g. a parent
 * re-render, route transition, or HMR) would too. We therefore persist the
 * "already exchanged" flag in `sessionStorage` keyed by the code itself, which
 * survives remounts. We also short-circuit if Faire is already connected.
 */
const EXCHANGED_PREFIX = "faire:oauth:exchanged:"

const FaireOauthCallback = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [exchanging, setExchanging] = useState(true)

  useEffect(() => {
    const errParam = params.get("error")
    if (errParam) {
      setError(
        `Faire authorization failed: ${params.get("error_description") || errParam}`
      )
      setExchanging(false)
      return
    }

    // Faire returns the authorization code as `authorization_code`
    // (some flows use `code`). Accept either.
    const code = params.get("authorization_code") || params.get("code")
    const state = params.get("state")
    if (!code || !state) {
      setError("Missing code or state in Faire callback.")
      setExchanging(false)
      return
    }

    // Already exchanged this exact code in this browser session — don't retry.
    // This guard is checked AND set synchronously, before any async work, so
    // that React StrictMode's double effect invocation (or any concurrent
    // remount) cannot race past it and exchange the single-use code twice.
    if (sessionStorage.getItem(EXCHANGED_PREFIX + code)) {
      navigate("/settings/faire", { replace: true })
      return
    }
    // Claim the code synchronously — any subsequent effect run will see this.
    sessionStorage.setItem(EXCHANGED_PREFIX + code, "1")

    let cancelled = false

    const run = async () => {
      try {
        await faireApi.callback(code, state)
        if (!cancelled) navigate("/settings/faire", { replace: true })
      } catch (err: any) {
        if (!cancelled) {
          // "code already used" can happen if a prior exchange succeeded but
          // the response was lost. If we are in fact connected, treat as success.
          try {
            const status: any = await faireApi.status()
            if (status?.connected) {
              navigate("/settings/faire", { replace: true })
              return
            }
          } catch {
            /* ignore */
          }
          setError(err.message || "Failed to complete Faire authorization.")
          setExchanging(false)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [params, navigate])

  return (
    <Container className="flex flex-col items-center gap-4 p-8">
      <Heading level="h1">Connecting Faire…</Heading>
      {error ? (
        <Alert variant="error">
          <Text>{error}</Text>
        </Alert>
      ) : (
        <Text>{exchanging ? "Completing authorization, please wait…" : "Redirecting…"}</Text>
      )}
      {error && (
        <Button
          size="small"
          variant="secondary"
          onClick={() => navigate("/settings/faire", { replace: true })}
        >
          Back to Faire settings
        </Button>
      )}
    </Container>
  )
}

export default FaireOauthCallback
