import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "@medusajs/ui"
import { sdk } from "../../../../lib/config"


export default function OAuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const id = sessionStorage.getItem("oauth_platform_id")
    const redirectUri = url.origin + url.pathname

    if (!code || !state || !id) {
      toast.error("OAuth failed – missing parameters")
      navigate("/settings/social-platforms")
      return
    }

    sdk.client
      .fetch(`/admin/oauth/twitter/callback`, {
        method: "POST",
        body: { code, state, id, redirect_uri: redirectUri },
      })
      .then(() => {
        toast.success("API connected ✔")
        navigate(`/settings/social-platforms/${id}`)
      })
      .catch((e: Error) => {
        toast.error(e.message)
        navigate(`/settings/social-platforms/${id}`)
      })
  }, [navigate])

  return null
}
