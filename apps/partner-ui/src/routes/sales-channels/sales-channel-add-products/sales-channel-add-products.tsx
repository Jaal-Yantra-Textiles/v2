import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useSalesChannel } from "../../../hooks/api/sales-channels"
import { AddProductsToSalesChannelForm } from "./components"

export const SalesChannelAddProducts = () => {
  const { id } = useParams()
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
    <RouteFocusModal>
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
      {!isLoading && sales_channel && (
        <AddProductsToSalesChannelForm salesChannel={sales_channel} />
      )}
    </RouteFocusModal>
  )
}
