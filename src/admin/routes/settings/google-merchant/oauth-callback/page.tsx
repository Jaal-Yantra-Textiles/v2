import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Container, Heading, Text, toast } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import { sdk } from "../../../../lib/config"

export default function GoogleMerchantOAuthCallbackPage() {
  const navigate = useNavigate()
  const fired = useRef(false)
  const [status, setStatus] = useState<"connecting" | "error">("connecting")
  const [message, setMessage] = useState("Connecting to Google Merchant Center…")

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")
    const accountId = localStorage.getItem("google_merchant_oauth_account_id")
    const storedState = localStorage.getItem("google_merchant_oauth_state")

    if (error) {
      setStatus("error")
      setMessage(`Google OAuth error: ${error}`)
      toast.error(`Google OAuth error: ${error}`)
      setTimeout(() => navigate("/settings/google-merchant"), 1500)
      return
    }
    if (!code || !accountId) {
      setStatus("error")
      setMessage("Missing OAuth callback parameters")
      toast.error("Missing OAuth callback parameters")
      setTimeout(() => navigate("/settings/google-merchant"), 1500)
      return
    }
    if (storedState && state && storedState !== state) {
      setStatus("error")
      setMessage("OAuth state mismatch — possible CSRF")
      toast.error("OAuth state mismatch")
      setTimeout(() => navigate("/settings/google-merchant"), 1500)
      return
    }

    setMessage("Exchanging code with Google…")

    sdk.client
      .fetch(`/admin/google-merchant/accounts/${accountId}/oauth-callback`, {
        method: "POST",
        body: { code, state },
      })
      .then(() => {
        toast.success("Google Merchant connected")
        localStorage.removeItem("google_merchant_oauth_account_id")
        localStorage.removeItem("google_merchant_oauth_state")
        navigate(`/settings/google-merchant/${accountId}`)
      })
      .catch((e: Error) => {
        setStatus("error")
        setMessage(e.message || "OAuth callback failed")
        toast.error(e.message || "OAuth callback failed")
        setTimeout(() => navigate(`/settings/google-merchant/${accountId}`), 1500)
      })
  }, [navigate])

  return (
    <Container className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-y-3">
        {status === "connecting" ? (
          <Spinner className="animate-spin text-ui-fg-subtle" />
        ) : null}
        <Heading level="h2">
          {status === "connecting" ? "Connecting to Google" : "Connection failed"}
        </Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {message}
        </Text>
      </div>
    </Container>
  )
}
