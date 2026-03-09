import { useMutation, useQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { toast } from "@medusajs/ui";

// ─── Store currencies ─────────────────────────────────────────────────────────

export type StoreCurrencyInfo = {
  currencies: string[]
  defaultCurrency: string
}

/** Fetches all supported currency codes for the store. Default currency is first. */
export const useStoreCurrencies = () => {
  return useQuery<StoreCurrencyInfo>({
    queryKey: ["store-currencies"],
    queryFn: async () => {
      const { stores } = await sdk.admin.store.list({
        fields: "id,*supported_currencies,supported_currencies.currency.*",
      })
      const store = stores?.[0]
      if (!store?.supported_currencies?.length) {
        return { currencies: ["usd"], defaultCurrency: "usd" }
      }

      const sorted = [...store.supported_currencies].sort((a: any, b: any) =>
        (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)
      )
      const defaultCurrency =
        (sorted.find((sc: any) => sc.is_default)?.currency_code ??
          sorted[0]?.currency_code ??
          "usd") as string

      return {
        currencies: sorted.map((sc: any) => sc.currency_code as string),
        defaultCurrency,
      }
    },
    staleTime: 10 * 60 * 1000,
  })
}

// ─── Exchange rates (Frankfurter — ECB data, no API key) ─────────────────────

export type ExchangeRates = {
  base: string
  rates: Record<string, number>
}

/**
 * Fetches live exchange rates from Frankfurter (api.frankfurter.app).
 * Rates are from `baseCurrency` to all other store currencies.
 * Only fetches when baseCurrency and targetCurrencies are known.
 */
export const useExchangeRates = (
  baseCurrency: string | undefined,
  targetCurrencies: string[]
) => {
  const targets = targetCurrencies.filter(
    (c) => c.toUpperCase() !== baseCurrency?.toUpperCase()
  )

  return useQuery<ExchangeRates>({
    queryKey: ["exchange-rates", baseCurrency, targets.sort().join(",")],
    queryFn: async () => {
      const base = baseCurrency!.toUpperCase()
      const url =
        targets.length > 0
          ? `https://api.frankfurter.app/latest?from=${base}&to=${targets.map((c) => c.toUpperCase()).join(",")}`
          : `https://api.frankfurter.app/latest?from=${base}`

      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch exchange rates")
      const data = await res.json()
      return { base: data.base, rates: data.rates ?? {} } as ExchangeRates
    },
    enabled: !!baseCurrency && targetCurrencies.length > 1,
    staleTime: 5 * 60 * 1000, // rates are fresh for 5 min (ECB updates once a day)
    retry: 1,
  })
}

/**
 * Given a base amount, base currency, and exchange rates, returns a map of
 * currency_code → converted amount (rounded to the nearest whole unit).
 */
export function buildConvertedPrices(
  amount: number,
  baseCurrency: string,
  allCurrencies: string[],
  rates: Record<string, number>
): Array<{ currency_code: string; amount: number }> {
  return allCurrencies.map((code) => {
    const upper = code.toUpperCase()
    const baseUpper = baseCurrency.toUpperCase()

    if (upper === baseUpper) {
      return { currency_code: code, amount: Math.round(amount) }
    }

    const rate = rates[upper]
    if (rate == null) {
      // Currency not in Frankfurter — fall back to same amount
      return { currency_code: code, amount: Math.round(amount) }
    }

    return { currency_code: code, amount: Math.round(amount * rate) }
  })
}

// ─── Product creation ─────────────────────────────────────────────────────────

const SIZES = ["S", "M", "L"] as const

export type SizeQuantities = { S?: number; M?: number; L?: number }

export type CreateProductFromMediaPayload = {
  title: string
  mediaFiles: Array<{ id: string; url: string }>
  folderId: string
  /**
   * Price in the store's default currency (major unit, e.g. 200 for €200).
   * Converted to all other store currencies via live Frankfurter exchange rates.
   */
  price?: number
  /** Whether to enable inventory tracking for all variants. */
  manageInventory?: boolean
  /** Per-size stock quantities. Only used when manageInventory=true. */
  quantities?: SizeQuantities
}

export const useCreateProductFromMedia = () => {
  return useMutation({
    mutationFn: async ({
      title,
      mediaFiles,
      folderId,
      price,
      manageInventory = false,
      quantities,
    }: CreateProductFromMediaPayload) => {
      // Fetch sales channels + store currencies in parallel
      const [{ sales_channels }, { stores }] = await Promise.all([
        sdk.admin.salesChannel.list({ limit: 10, fields: "id,is_disabled" }),
        sdk.admin.store.list({
          fields: "id,*supported_currencies,supported_currencies.currency.*",
        }),
      ])

      const activeChannel =
        sales_channels?.find((sc: any) => !sc.is_disabled) ?? sales_channels?.[0]
      const salesChannelId = activeChannel?.id

      const store = stores?.[0]
      const supportedCurrencies: string[] =
        store?.supported_currencies?.map((sc: any) => sc.currency_code as string) ?? []

      const defaultCurrency =
        (store?.supported_currencies
          ?.find((sc: any) => sc.is_default)
          ?.currency_code ?? supportedCurrencies[0] ?? "usd") as string

      // Build price entries for all currencies with live exchange rate conversion
      let priceEntries: Array<{ currency_code: string; amount: number }> = []

      if (price != null && price > 0 && supportedCurrencies.length) {
        const amount = Math.round(price)
        const otherCurrencies = supportedCurrencies.filter(
          (c) => c.toUpperCase() !== defaultCurrency.toUpperCase()
        )

        let rates: Record<string, number> = {}

        if (otherCurrencies.length > 0) {
          try {
            const base = defaultCurrency.toUpperCase()
            const targets = otherCurrencies.map((c) => c.toUpperCase()).join(",")
            const res = await fetch(
              `https://api.frankfurter.app/latest?from=${base}&to=${targets}`
            )
            if (res.ok) {
              const data = await res.json()
              rates = data.rates ?? {}
            }
          } catch {
            // Network failure — fall back to same amount for all currencies
          }
        }

        priceEntries = buildConvertedPrices(amount, defaultCurrency, supportedCurrencies, rates)
      }

      const thumbnail = mediaFiles[0]?.url
      const images = mediaFiles.map((f) => ({ url: f.url }))

      const payload: any = {
        title,
        status: "draft",
        is_giftcard: false,
        discountable: true,
        thumbnail,
        images,
        metadata: {
          created_from_media: true,
          folder_id: folderId,
          media_ids: mediaFiles.map((f) => f.id),
        },
        options: [{ title: "Size", values: [...SIZES] }],
        variants: SIZES.map((size) => ({
          title: size,
          options: { Size: size },
          manage_inventory: manageInventory,
          prices: priceEntries,
        })),
      }

      if (salesChannelId) {
        payload.sales_channels = [{ id: salesChannelId }]
      }

      const result = await sdk.admin.product.create(payload)
      const product = result.product

      if (
        manageInventory &&
        quantities &&
        Object.values(quantities).some((q) => q != null && q > 0)
      ) {
        await setInventoryLevels(product, quantities)
      }

      return product
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to create product")
    },
  })
}

async function setInventoryLevels(product: any, quantities: SizeQuantities) {
  const { stock_locations } = await sdk.admin.stockLocation.list({ limit: 1 })
  const locationId = stock_locations?.[0]?.id
  if (!locationId) return

  const { product: full } = await sdk.admin.product.retrieve(product.id, {
    fields: "+variants.inventory_items.*",
  })

  for (const variant of full?.variants ?? []) {
    const size = variant.title as keyof SizeQuantities
    const qty = quantities[size]
    if (!qty || qty <= 0) continue

    const inventoryItemId =
      variant.inventory_items?.[0]?.inventory_item_id ??
      variant.inventory_items?.[0]?.id
    if (!inventoryItemId) continue

    try {
      await sdk.admin.inventoryItem.batchInventoryItemLocationLevels(inventoryItemId, {
        create: [{ location_id: locationId, stocked_quantity: qty }],
      })
    } catch {
      await sdk.admin.inventoryItem.updateLevel(inventoryItemId, locationId, {
        stocked_quantity: qty,
      })
    }
  }
}
