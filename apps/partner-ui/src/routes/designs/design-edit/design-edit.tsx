import { Heading } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"
import { EditDesignForm } from "./components/edit-design-form"

export const DesignEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()
  const { design, isLoading, isError, error } = usePartnerDesign(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("partner.designs.edit.heading")}</Heading>
      </RouteDrawer.Header>
      {isLoading && !design && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && design && <EditDesignForm design={design} />}
    </RouteDrawer>
  )
}
