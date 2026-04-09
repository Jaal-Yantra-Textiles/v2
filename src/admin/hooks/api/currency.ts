import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { sdk } from "../../lib/config"
import { useDefaultStore } from "./stores"

/**
 * Get the store's default currency code (e.g. "EUR", "INR", "USD").
 * Falls back to "USD" if no default is configured.
 */
export const useStoreCurrency = (): { code: string; isLoading: boolean } => {
  const { store, isLoading } = useDefaultStore()

  const code = useMemo(() => {
    const defaultCurrency = store?.supported_currencies?.find(
      (c: any) => c.is_default
    )
    return (defaultCurrency?.currency_code || "USD").toUpperCase()
  }, [store])

  return { code, isLoading }
}

/**
 * Fetch a live exchange rate between two currencies via the backend proxy
 * (Frankfurter/ECB). Rates are cached in-memory on the backend for 1 hour
 * and in TanStack Query for 1 hour here.
 */
export const useExchangeRate = (from?: string | null, to?: string | null) => {
  const fromCode = (from || "").toUpperCase()
  const toCode = (to || "").toUpperCase()
  const enabled = !!fromCode && !!toCode && fromCode !== toCode

  return useQuery({
    queryKey: ["exchange-rate", fromCode, toCode],
    enabled,
    staleTime: 60 * 60 * 1000, // 1 hour
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        from: string
        to: string
        rate: number
      }>(`/admin/exchange-rate?from=${fromCode}&to=${toCode}`)
      return res
    },
  })
}

/**
 * Convenience hook for ad-planning pages: returns a `formatCurrency` function
 * that formats an amount in the store's default currency, with optional
 * source-currency conversion (e.g. Meta Ads spend in INR → displayed in EUR).
 */
export const useCurrencyFormatter = (sourceCurrency?: string) => {
  const { code: storeCurrency, isLoading: storeLoading } = useStoreCurrency()
  const { data: exchangeData, isLoading: rateLoading } = useExchangeRate(
    sourceCurrency,
    storeCurrency
  )

  const rate = exchangeData?.rate ?? 1
  const needsConversion =
    !!sourceCurrency &&
    sourceCurrency.toUpperCase() !== storeCurrency &&
    rate !== 1

  const formatCurrency = useMemo(() => {
    return (
      amount: number | null | undefined,
      opts?: { convert?: boolean }
    ): string => {
      if (amount === null || amount === undefined || isNaN(Number(amount))) {
        return "—"
      }

      const convert = opts?.convert ?? true
      const value =
        convert && needsConversion
          ? Math.round(Number(amount) * rate * 100) / 100
          : Number(amount)

      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: storeCurrency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value)
      } catch {
        return `${storeCurrency} ${value.toFixed(2)}`
      }
    }
  }, [storeCurrency, rate, needsConversion])

  return {
    formatCurrency,
    storeCurrency,
    sourceCurrency: sourceCurrency?.toUpperCase(),
    rate,
    isLoading: storeLoading || rateLoading,
  }
}
