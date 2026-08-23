import { RouteFocusModal } from "../../../components/modals"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { QuoteCreateForm } from "./components/quote-create-form/quote-create-form"

/**
 * Orders → Quotes → Create.
 *
 * Currencies come from the partner's own store rather than a global list — the
 * mint prices against that store, so offering a currency it does not support
 * would produce a quote nothing can fulfil.
 */
export const QuoteCreate = () => {
  const { stores, isPending } = usePartnerStores()
  const store = stores?.[0]

  const supported = (store?.supported_currencies ?? []).map(
    (c: { currency_code: string }) => c.currency_code
  )
  const defaultCurrency = (store?.supported_currencies ?? []).find(
    (c: { is_default?: boolean }) => c.is_default
  )?.currency_code

  /**
   * Where this store's goods dispatch from (#1447). Decides whether the DDP
   * section means anything: on a domestic lane there is no border, so no import
   * duty or tax to prepay.
   *
   * 🔴 Null is UNKNOWN, never "domestic". Hiding the question on a real export
   * is the failure that costs a buyer a customs bill we told them would not
   * come; asking it on a domestic quote costs a moment's confusion.
   */
  const originCountryCode =
    store?.location?.address?.country_code?.toUpperCase() || null

  return (
    <RouteFocusModal>
      {!isPending && (
        <QuoteCreateForm
          currencies={supported}
          defaultCurrency={defaultCurrency}
          originCountryCode={originCountryCode}
        />
      )}
    </RouteFocusModal>
  )
}
