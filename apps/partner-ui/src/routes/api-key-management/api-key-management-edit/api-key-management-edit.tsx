import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { VisuallyHidden } from "../../../components/utilities/visually-hidden"
import { useApiKey } from "../../../hooks/api/api-keys"
import { EditApiKeyForm } from "./components/edit-api-key-form"

export const ApiKeyManagementEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { api_key, isLoading, isError, error } = useApiKey(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("apiKeyManagement.edit.header")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description asChild>
          <VisuallyHidden>
            {t("apiKeyManagement.edit.description")}
          </VisuallyHidden>
        </RouteDrawer.Description>
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
      {!isLoading && !!api_key && <EditApiKeyForm apiKey={api_key} />}
    </RouteDrawer>
  )
}
