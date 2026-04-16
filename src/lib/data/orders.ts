"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { HttpTypes } from "@medusajs/types"

const ORDER_FIELDS = [
  "*payment_collections.payments",
  "*items",
  "*items.metadata",
  "*items.variant",
  "*items.product",
  "*items.detail",
  "*fulfillments",
  "+fulfillment_status",
  "+payment_status",
  "+status",
  "+cart.id",
].join(",")

const ORDER_LIST_FIELDS = [
  "*items",
  "+items.metadata",
  "*items.variant",
  "*items.product",
  "+fulfillment_status",
  "+payment_status",
  "+status",
].join(",")

export const retrieveOrder = async (id: string) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderResponse>(`/store/orders/${id}`, {
      method: "GET",
      query: {
        fields: ORDER_FIELDS,
      },
      headers,
      next,
      //cache: "force-cache",
    })
    .then(({ order }) => order)
    .catch((err) => medusaError(err))
}

/**
 * Retrieve an order without authentication (for public order pages).
 * Uses the order ID only — no auth header needed for basic order info.
 */
export const retrievePublicOrder = async (id: string) => {
  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderResponse>(`/store/orders/${id}`, {
      method: "GET",
      query: {
        fields: ORDER_FIELDS,
      },
      next,
      cache: "force-cache",
    })
    .then(({ order }) => order)
    .catch(() => null)
}

export const listOrders = async (
  limit: number = 10,
  offset: number = 0,
  filters?: Record<string, any>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("orders")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreOrderListResponse>(`/store/orders`, {
      method: "GET",
      query: {
        limit,
        offset,
        order: "-created_at",
        fields: ORDER_LIST_FIELDS,
        ...filters,
      },
      headers,
      next,
      cache: "force-cache",
    })
    .then(({ orders }) => orders)
    .catch((err) => medusaError(err))
}

// ─── Return types ────────────────────────────────────────────────────────────

export type ReturnReason = {
  id: string
  value: string
  label: string
  description?: string
}

export type ReturnRequestItem = {
  id: string
  quantity: number
  reason_id?: string
  note?: string
}

export type ReturnRequestInput = {
  order_id: string
  items: ReturnRequestItem[]
  return_shipping: {
    option_id: string
    price?: number
  }
  note?: string
}

// ─── Return shipping options ─────────────────────────────────────────────────

export type ReturnShippingOption = {
  id: string
  name: string
  amount: number
  currency_code?: string
  calculated_price?: {
    calculated_amount: number
    currency_code: string
  }
}

/**
 * Fetches available return shipping options for an order via its linked cart.
 * Uses GET /store/shipping-options?cart_id=xxx&is_return=true
 */
export const listReturnShippingOptions = async (
  cartId: string
): Promise<ReturnShippingOption[]> => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("return-shipping")),
  }

  try {
    const data = await sdk.client.fetch<
      HttpTypes.StoreShippingOptionListResponse
    >(`/store/shipping-options`, {
      method: "GET",
      query: {
        cart_id: cartId,
        is_return: true,
      },
      headers,
      next,
      cache: "force-cache",
    })
    return (data.shipping_options || []) as unknown as ReturnShippingOption[]
  } catch {
    return []
  }
}

// ─── Return data functions ───────────────────────────────────────────────────

export const listReturnReasons = async (): Promise<ReturnReason[]> => {
  try {
    const data = await sdk.client.fetch<{
      return_reasons: ReturnReason[]
    }>(`/store/return-reasons`, {
      method: "GET",
      cache: "force-cache",
    })
    return data.return_reasons || []
  } catch {
    return []
  }
}

export const createReturnRequest = async (
  input: ReturnRequestInput
): Promise<{ return: any }> => {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  }

  return sdk.client.fetch<{ return: any }>(`/store/returns`, {
    method: "POST",
    body: input,
    headers,
  })
}

export const createTransferRequest = async (
  state: {
    success: boolean
    error: string | null
    order: HttpTypes.StoreOrder | null
  },
  formData: FormData
): Promise<{
  success: boolean
  error: string | null
  order: HttpTypes.StoreOrder | null
}> => {
  const id = formData.get("order_id") as string

  if (!id) {
    return { success: false, error: "Order ID is required", order: null }
  }

  const headers = await getAuthHeaders()

  return await sdk.store.order
    .requestTransfer(
      id,
      {},
      {
        fields: "id, email",
      },
      headers
    )
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}

export const acceptTransferRequest = async (id: string, token: string) => {
  const headers = await getAuthHeaders()

  return await sdk.store.order
    .acceptTransfer(id, { token }, {}, headers)
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}

export const declineTransferRequest = async (id: string, token: string) => {
  const headers = await getAuthHeaders()

  return await sdk.store.order
    .declineTransfer(id, { token }, {}, headers)
    .then(({ order }) => ({ success: true, error: null, order }))
    .catch((err) => ({ success: false, error: err.message, order: null }))
}
