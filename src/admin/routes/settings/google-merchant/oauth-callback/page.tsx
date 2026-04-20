import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "@medusajs/ui"
import { sdk } from "../../../../lib/config"

export default function GoogleMerchantOAuthCallbackPage() {
  const navigate = useNavigate()
  const fired = useRef(false)

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
      toast.error(`Google OAuth error: ${error}`)
      navigate("/settings/google-merchant")
      return
    }
    if (!code || !accountId) {
      toast.error("Missing OAuth callback parameters")
      navigate("/settings/google-merchant")
      return
    }
    if (storedState && state && storedState !== state) {
      toast.error("OAuth state mismatch")
      navigate("/settings/google-merchant")
      return
    }

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
        toast.error(e.message || "OAuth callback failed")
        navigate(`/settings/google-merchant/${accountId}`)
      })
  }, [navigate])

  return null
}
