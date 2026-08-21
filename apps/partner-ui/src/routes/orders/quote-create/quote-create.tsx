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

  return (
    <RouteFocusModal>
      {!isPending && (
        <QuoteCreateForm
          currencies={supported}
          defaultCurrency={defaultCurrency}
        />
      )}
    </RouteFocusModal>
  )
}
