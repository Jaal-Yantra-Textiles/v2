"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"

export type ShowcaseProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  price: { amount: number; currency_code: string } | null
}

export type ShowcasePartner = {
  id: string
  name: string
  handle: string
  logo: string | null
  storefront_url: string | null
  store: { id: string; name: string }
  categories: Array<{ id: string; name: string; handle: string }>
  collections: Array<{ id: string; title: string; handle: string }>
  featured_products: ShowcaseProduct[]
  product_count: number
}

export type PartnerShowcaseResponse = {
  partners: ShowcasePartner[]
  count: number
}

export const getPartnerShowcase =
  async (): Promise<PartnerShowcaseResponse> => {
    const next = {
      ...(await getCacheOptions("partner-showcase")),
    }

    return sdk.client
      .fetch<PartnerShowcaseResponse>("/store/partner-showcase", {
        next,
        cache: "force-cache",
      })
      .catch(() => ({ partners: [], count: 0 }))
  }
