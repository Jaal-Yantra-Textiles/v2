import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { usePromotion } from "../../../hooks/api/promotions"
import { EditPromotionDetailsForm } from "./components/edit-promotion-form"

export const PromotionEditDetails = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { promotion, isLoading, isError, error } = usePromotion(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("promotions.edit.title")}</Heading>
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

      {!isLoading && promotion && (
        <EditPromotionDetailsForm promotion={promotion} />
      )}
    </RouteDrawer>
  )
}
