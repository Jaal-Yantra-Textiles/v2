import { useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "@medusajs/ui"
import { sdk } from "../../../../../../lib/config"

export default function OAuthCallbackDynamicPage() {
  const navigate = useNavigate()
  const { platform } = useParams<{ platform: string }>()
  const hasFired = useRef(false)

  useEffect(() => {
    if (hasFired.current) {
      return
    }
    hasFired.current = true

    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const id = localStorage.getItem("oauth_platform_id")

    if (!platform) return

    if (!code || !state || !id) {
      toast.error("OAuth failed – missing parameters")
      navigate("/settings/external-platforms")
      return
    }

    // Google Business Manager rows go through the per-row callback so the
    // workflow can match the SocialPlatform by id and verify the state
    // stored in api_config.pending_oauth_state.
    const callbackUrl =
      platform === "google"
        ? `/admin/social-platforms/${id}/google/oauth-callback`
        : `/admin/oauth/${platform}/callback`

    const callbackBody =
      platform === "google" ? { code, state } : { code, state, id }

    sdk.client
      .fetch(callbackUrl, {
        method: "POST",
        body: callbackBody,
      })
      .then(() => {
        toast.success("API connected ✔")
        localStorage.removeItem("oauth_platform_id")
        localStorage.removeItem("oauth_platform_kind")
        navigate(`/settings/external-platforms/${id}`)
      })
      .catch((e: Error) => {
        toast.error(e.message)
        navigate(`/settings/external-platforms/${id}`)
      })
  }, [navigate, platform])

  return null
}
