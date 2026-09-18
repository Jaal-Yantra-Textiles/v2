import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { VisuallyHidden } from "../../../components/utilities/visually-hidden"
import { useCampaign } from "../../../hooks/api/campaigns"
import { EditCampaignForm } from "./components/edit-campaign-form"

export const CampaignEdit = () => {
  const { t } = useTranslation()

  const { id } = useParams()
  const { campaign, isLoading, isError, error } = useCampaign(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("campaigns.edit.header")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description asChild>
          <VisuallyHidden>{t("campaigns.edit.description")}</VisuallyHidden>
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

      {!isLoading && campaign && <EditCampaignForm campaign={campaign} />}
    </RouteDrawer>
  )
}
