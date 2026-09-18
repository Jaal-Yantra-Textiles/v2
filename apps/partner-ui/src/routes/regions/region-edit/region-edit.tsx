import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { usePaymentProviders } from "../../../hooks/api/payments"
import { useRegion } from "../../../hooks/api/regions"
import { useStore } from "../../../hooks/api/store"
import { currencies } from "../../../lib/data/currencies"
import { EditRegionForm } from "./components/edit-region-form"
import { usePricePreferences } from "../../../hooks/api/price-preferences"

export const RegionEdit = () => {
  const { t } = useTranslation()
  const { id } = useParams()

  const {
    region,
    isPending: isRegionLoading,
    isError: isRegionError,
    error: regionError,
  } = useRegion(id!, {
    fields: "*payment_providers,*countries,+automatic_taxes",
  })

  const {
    store,
    isPending: isStoreLoading,
    isError: isStoreError,
    error: storeError,
  } = useStore()

  const {
    price_preferences: pricePreferences = [],
    isPending: isPreferenceLoading,
    isError: isPreferenceError,
    error: preferenceError,
  } = usePricePreferences(
    {
      attribute: "region_id",
      value: id,
    },
    { enabled: !!region }
  )

  const isLoading = isRegionLoading || isStoreLoading || isPreferenceLoading

  // Show every known currency, not just the store's
  // `supported_currencies` — same rationale as region-create. The
  // partner can change a region's currency to anything the system
  // knows; the backend doesn't gate on supported_currencies.
  const allCurrencies = Object.values(currencies)

  if (isRegionError) {
    throw regionError
  }

  if (isStoreError) {
    throw storeError
  }

  if (isPreferenceError) {
    throw preferenceError
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("regions.editRegion")}</Heading>
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
      {!isLoading && region && (
        <EditRegionForm
          region={region}
          currencies={allCurrencies}
          pricePreferences={pricePreferences}
        />
      )}
    </RouteDrawer>
  )
}
