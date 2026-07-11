import { RouteDrawer } from "../../../../components/modals"
import { useMe } from "../../../../hooks/api/users"
import { EditVerificationSection } from "../components/edit-verification-section/edit-verification-section"

export const VerificationEdit = () => {
  const { user, isPending, isError, error } = useMe()

  if (isPending || !user) {
    return null
  }

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Edit verification</RouteDrawer.Title>
      </RouteDrawer.Header>
      <EditVerificationSection investor={user as any} />
    </RouteDrawer>
  )
}
