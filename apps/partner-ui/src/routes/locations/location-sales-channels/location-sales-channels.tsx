import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useStockLocation } from "../../../hooks/api/stock-locations"
import { LocationEditSalesChannelsForm } from "./components/edit-sales-channels-form"

export const LocationSalesChannels = () => {
  const { location_id } = useParams()
  const { stock_location, isPending, isError, error } = useStockLocation(
    location_id!,
    {
      fields: "id,*sales_channels",
    }
  )

  const ready = !isPending && !!stock_location

  if (isError) {
    throw error
  }

  return (
    <RouteFocusModal>
      {!ready && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {ready && <LocationEditSalesChannelsForm location={stock_location} />}
    </RouteFocusModal>
  )
}
