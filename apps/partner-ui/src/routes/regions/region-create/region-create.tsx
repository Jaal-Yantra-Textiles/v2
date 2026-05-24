import { RouteFocusModal } from "../../../components/modals/route-focus-modal"
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
      {!isLoading && store && <CreateRegionForm currencies={allCurrencies} />}
    </RouteFocusModal>
  )
}
