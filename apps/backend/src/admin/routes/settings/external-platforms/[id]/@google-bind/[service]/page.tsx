import { useParams } from "react-router-dom"
import { Heading } from "@medusajs/ui"
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer"
import { GoogleBindForm } from "../../../../../../components/social-platforms/google/google-bind-form"
import type { GoogleService } from "../../../../../../hooks/api/google-business"

const VALID_SERVICES: GoogleService[] = [
  "merchant",
  "ads",
  "search-console",
  "business-profile",
]

const SERVICE_TITLES: Record<GoogleService, string> = {
  merchant: "Bind Merchant Center",
  ads: "Bind Google Ads",
  "search-console": "Bind Search Console",
  "business-profile": "Bind Business Profile",
}

export default function GoogleBindDrawerPage() {
  const { id, service } = useParams<{ id: string; service: string }>()

  if (!id || !service || !VALID_SERVICES.includes(service as GoogleService)) {
    return null
  }

  const svc = service as GoogleService

  return (
    <RouteDrawer prev="../..">
      <RouteDrawer.Header>
        <Heading>{SERVICE_TITLES[svc]}</Heading>
      </RouteDrawer.Header>
      <GoogleBindForm platformId={id} service={svc} />
    </RouteDrawer>
  )
}
