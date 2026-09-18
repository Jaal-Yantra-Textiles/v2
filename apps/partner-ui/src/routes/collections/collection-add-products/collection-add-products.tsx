import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useCollection } from "../../../hooks/api/collections"
import { AddProductsToCollectionForm } from "./components/add-products-to-collection-form"

export const CollectionAddProducts = () => {
  const { id } = useParams()
  const { collection, isLoading, isError, error } = useCollection(id!)

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
      {!isLoading && collection && (
        <AddProductsToCollectionForm collection={collection} />
      )}
    </RouteFocusModal>
  )
}
