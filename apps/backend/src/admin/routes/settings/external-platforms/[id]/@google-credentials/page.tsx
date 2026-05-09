import { useParams, useLoaderData } from "react-router-dom"
import { Heading } from "@medusajs/ui"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { GoogleCredentialsForm } from "../../../../../components/social-platforms/google/google-credentials-form"
import { useSocialPlatform } from "../../../../../hooks/api/social-platforms"
import { socialPlatformLoader } from "../loader"

export default function GoogleCredentialsDrawerPage() {
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
        <Heading>Google OAuth credentials</Heading>
      </RouteDrawer.Header>
      <GoogleCredentialsForm platform={socialPlatform} />
    </RouteDrawer>
  )
}
