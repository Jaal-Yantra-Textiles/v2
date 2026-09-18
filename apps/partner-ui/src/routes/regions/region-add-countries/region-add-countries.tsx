import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useRegion } from "../../../hooks/api/regions"
import { AddCountriesForm } from "./components/add-countries-form"

export const RegionAddCountries = () => {
  const { id } = useParams()

  const {
    region,
    isPending: isLoading,
    isError,
    error,
  } = useRegion(id!, {
    fields: "*payment_providers",
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
      {!isLoading && region && <AddCountriesForm region={region} />}
    </RouteFocusModal>
  )
}
