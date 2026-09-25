"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getAuthHeaders, getCacheOptions } from "./cookies"

export const listCartShippingMethods = async (cartId: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreShippingOptionListResponse>(
      `/store/shipping-options`,
      {
        method: "GET",
        query: {
          cart_id: cartId,
        },
        headers,
        /**
         * 🔴 NOT force-cached. The eligible options depend on the cart's
         * SHIPPING ADDRESS, so this list changes under a cart that has not
         * changed id.
         *
         * Observed in production on a live Swedish order: the cart was created
         * with no country (nothing could set one — see #2190), its checkout
         * rendered once, and the option list was frozen at the unfiltered set.
         * Proven with a control — the same Europe region answers
         *
         *   no country -> 7 options, including Delhivery and In Person Pickup
         *   country se -> 2 options
         *
         * and the buyer was still being shown all 7 an hour after the country
         * was set. A buyer can therefore pick, and pay for, a courier that
         * does not serve their address — Delhivery to Sweden.
         *
         * Same reasoning as `quote-terms` in `data/cart.ts`: tagged so a cart
         * mutation revalidates it, never `force-cache`, because a stale copy
         * of a thing that flips is worse than a slower render.
         */
        next,
      }
    )
    .then(({ shipping_options }) => shipping_options)
    .catch(() => {
      return null
    })
}

export const calculatePriceForShippingOption = async (
  optionId: string,
  cartId: string,
  data?: Record<string, unknown>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  const body = { cart_id: cartId, data }

  if (data) {
    body.data = data
  }

  return sdk.client
    .fetch<{ shipping_option: HttpTypes.StoreCartShippingOption }>(
      `/store/shipping-options/${optionId}/calculate`,
      {
        method: "POST",
        body,
        headers,
        next,
      }
    )
    .then(({ shipping_option }) => shipping_option)
    .catch((e) => {
      return null
    })
}
