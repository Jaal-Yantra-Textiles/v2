"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { updateTag } from "next/cache"
import { redirect } from "next/navigation"

import { getAuthHeaders, getCacheOptions, getCacheTag } from "./cookies"
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
// The public order page is where buyers come for updates (shipped, tracking,
// refunds), so it must never serve a cached copy of the order.
export const retrievePublicOrder = async (id: string) => {
  return sdk.client
    .fetch<HttpTypes.StoreOrderResponse>(`/store/orders/${id}`, {
      method: "GET",
      query: {
        fields: ORDER_FIELDS,
      },
      cache: "no-store",
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

/**
 * A signed-in customer cancels their own order. The backend only allows it
 * while nothing is paid or shipped (store/orders/:id/cancel).
 */
export const cancelOrder = async (
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const headers = { ...(await getAuthHeaders()) }
  try {
    await sdk.client.fetch(`/store/orders/${id}/cancel`, {
      method: "POST",
      headers,
    })
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not cancel this order" }
  }
  const tag = await getCacheTag("orders")
  if (tag) updateTag(tag)
  return { ok: true }
}

/**
 * "Track your order": order number + the email it was placed with → the
 * public order page. The backend answers the same "not found" for a wrong
 * number or a wrong email, and rate-limits tries.
 */
type LookupState = { error: string | null; order_number?: string; email?: string }

export async function lookupOrder(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const order_number = String(formData.get("order_number") || "").trim()
  const email = String(formData.get("email") || "").trim()
  const countryCode = String(formData.get("country_code") || "in").toLowerCase()
  // Echo the inputs back: React resets a form after its action runs.
  const fail = (error: string): LookupState => ({ error, order_number, email })
  if (!order_number || !email) return fail("Enter your order number and email.")

  let orderId: string | null = null
  try {
    const res = await sdk.client.fetch<{ order_id: string }>(`/store/order-lookup`, {
      method: "POST",
      body: { order_number, email },
      cache: "no-store",
    })
    orderId = res?.order_id ?? null
  } catch (e: any) {
    const msg = String(e?.message || "")
    return fail(/too many/i.test(msg) ? msg : "We couldn't find an order with that number and email.")
  }
  if (!orderId) return fail("We couldn't find an order with that number and email.")
  redirect(`/${countryCode}/order/${orderId}`)
}
