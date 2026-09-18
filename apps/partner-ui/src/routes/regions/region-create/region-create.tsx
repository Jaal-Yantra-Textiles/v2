import { RouteFocusModal } from "../../../components/modals/route-focus-modal"
import { Skeleton } from "../../../components/common/skeleton"
import { useStore } from "../../../hooks/api/store"
import { currencies } from "../../../lib/data/currencies"
import { CreateRegionForm } from "./components/create-region-form"

export const RegionCreate = () => {
  const { store, isPending: isLoading, isError, error } = useStore()

  // Show every known currency, not just the store's
  // `supported_currencies`. Restricting to supported_currencies makes
  // it impossible for a partner to spin up a region in a currency they
  // haven't pre-configured on their store — but our backend accepts
  // any currency on region create and the store can expand its
  // supported_currencies as needed. Surfaced by partner-ui testing of
  // PR feat/partner-regions-admin-parity.
  const allCurrencies = Object.values(currencies)

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
      {!isLoading && store && <CreateRegionForm currencies={allCurrencies} />}
    </RouteFocusModal>
  )
}
