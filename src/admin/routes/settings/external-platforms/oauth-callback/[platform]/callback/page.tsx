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

    sdk.client
      .fetch(`/admin/oauth/${platform}/callback`, {
        method: "POST",
        body: { code, state, id },
      })
      .then(() => {
        toast.success("API connected ✔")
        navigate(`/settings/external-platforms/${id}`)
      })
      .catch((e: Error) => {
        toast.error(e.message)
        navigate(`/settings/external-platforms/${id}`)
      })
  }, [navigate, platform])

  return null
}
