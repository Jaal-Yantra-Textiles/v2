import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useProduct } from "../../../hooks/api/products"
import { EditSalesChannelsForm } from "./components/edit-sales-channels-form"

export const ProductSalesChannels = () => {
  const { id } = useParams()
  const { product, isLoading, isError, error } = useProduct(id!, {
    // TODO: Remove exclusion once we avoid including unnecessary relations by default in the query config
    fields: "-type,-collection,-options,-tags,-images,-variants",
  })

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
      {!isLoading && product && <EditSalesChannelsForm product={product} />}
    </RouteFocusModal>
  )
}
