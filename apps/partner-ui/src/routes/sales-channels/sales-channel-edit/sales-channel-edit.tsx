import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useSalesChannel } from "../../../hooks/api/sales-channels"
import { EditSalesChannelForm } from "./components/edit-sales-channel-form"

export const SalesChannelEdit = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const {
    sales_channel,
    isPending: isLoading,
    isError,
    error,
  } = useSalesChannel(id!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading className="capitalize">
          {t("salesChannels.editSalesChannel")}
        </Heading>
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
      {!isLoading && !!sales_channel && (
        <EditSalesChannelForm salesChannel={sales_channel} />
      )}
    </RouteDrawer>
  )
}
