import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useUser } from "../../../hooks/api/users"
import { EditUserForm } from "./components/edit-user-form"

export const UserEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()
  const { user, isPending: isLoading, isError, error } = useUser(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("users.editUser")}</Heading>
      </RouteDrawer.Header>
      {isLoading && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && user && <EditUserForm user={user} />}
    </RouteDrawer>
  )
}
