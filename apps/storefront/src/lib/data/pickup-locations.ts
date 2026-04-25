"use server"

import { sdk } from "@lib/config"
import { getCacheOptions } from "./cookies"

export type PickupOption = {
  id: string
  name: string
  price_type: string
  price: { amount: number; currency_code: string } | null
}

export type PickupLocation = {
  id: string
  name: string
  address: {
    address_1: string
    address_2: string | null
    city: string
    province: string
    postal_code: string
    country_code: string
    phone: string | null
  }
  pickup_options: PickupOption[]
  proximity: number
}

export type PickupLocationsResponse = {
  pickup_locations: PickupLocation[]
  count: number
}

export const getPickupLocations = async (
  postalCode: string,
  countryCode?: string
): Promise<PickupLocationsResponse> => {
  const next = {
    ...(await getCacheOptions("pickup-locations")),
  }

  const query: Record<string, string> = {}
  if (postalCode) query.postal_code = postalCode
  if (countryCode) query.country_code = countryCode

  return sdk.client
    .fetch<PickupLocationsResponse>("/store/pickup-locations", {
      query,
      next,
      cache: "no-store",
    })
    .catch(() => ({ pickup_locations: [], count: 0 }))
}
