import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { usePricePreferences } from "../../../hooks/api/price-preferences"
import { useStore } from "../../../hooks/api/store"
import { AddCurrenciesForm } from "./components/add-currencies-form/add-currencies-form"

export const StoreAddCurrencies = () => {
  const { store, isPending, isError, error } = useStore()

  const {
    price_preferences: pricePreferences,
    isPending: isPricePreferencesPending,
    isError: isPricePreferencesError,
    error: pricePreferencesError,
  } = usePricePreferences(
    {
      attribute: "currency_code",
      value: store?.supported_currencies?.map(
        (c: { currency_code: string }) => c.currency_code
      ),
    },
    {
      enabled: !!store,
    }
  )

  const ready =
    !!store && !isPending && !!pricePreferences && !isPricePreferencesPending

  if (isError) {
    throw error
  }

  if (isPricePreferencesError) {
    throw pricePreferencesError
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
      {ready && (
        <AddCurrenciesForm store={store} pricePreferences={pricePreferences} />
      )}
    </RouteFocusModal>
  )
}
