import { useParams, useLoaderData } from "react-router-dom"
import { Heading } from "@medusajs/ui"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { GoogleConnectForm } from "../../../../../components/social-platforms/google/google-connect-form"
import { useSocialPlatform } from "../../../../../hooks/api/social-platforms"
import { socialPlatformLoader } from "../loader"

export default function GoogleConnectDrawerPage() {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<
    ReturnType<typeof socialPlatformLoader>
  >

  const { socialPlatform, isLoading } = useSocialPlatform(id!, { initialData })

  if (isLoading || !socialPlatform) {
    return null
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Connect Google services</Heading>
      </RouteDrawer.Header>
      <GoogleConnectForm platform={socialPlatform} />
    </RouteDrawer>
  )
}
