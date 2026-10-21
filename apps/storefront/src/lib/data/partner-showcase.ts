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
  /** #2444 — has a public page at /partners/<handle>. */
  is_public?: boolean
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
    // `force-cache` with only a per-visitor tag never expired (#2442's story
    // fetch had the same shape): a partner switched public would never link.
    const next = {
      ...(await getCacheOptions("partner-showcase")),
      revalidate: 300,
    }

    return sdk.client
      .fetch<PartnerShowcaseResponse>("/store/partner-showcase", { next })
      .catch(() => ({ partners: [], count: 0 }))
  }
