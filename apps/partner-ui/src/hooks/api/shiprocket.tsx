import {
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { ordersQueryKeys } from "./orders"
import { FetchError } from "@medusajs/js-sdk"

/**
 * Partner-side Shiprocket carrier mutations (#639) — mirror the admin
 * Design-Orders hooks (`apps/backend/src/admin/hooks/api/design-orders.ts`)
 * against the partner routes:
 *   POST /partners/orders/:id/shiprocket-label
 *   POST /partners/orders/:id/shiprocket-attach-awb
 * Ownership is enforced server-side inside each handler.
 */

export type GenerateShiprocketLabelResponse = {
  shiprocket_label: {
    awb?: string
    tracking_number?: string
    label_url?: string
    tracking_url?: string
    fulfillment_id: string
  }
}

export type GenerateShiprocketLabelVariables = {
  preferred_courier_id?: string | number
  carrier?: string
  /** Chargeable parcel weight in grams. Omitted → backend default weight. */
  weight_grams?: number
  /** Parcel box in cm. All three or none — a partial box is ignored server-side. */
  dimensions_cm?: { length?: number; width?: number; height?: number }
}

/**
 * Generate a Shiprocket label for one of the partner's own orders (create
 * fulfillment → shipment → AWB). Optionally passes a chosen courier (#641)
 * and the carrier (defaults to "shiprocket" on the backend).
 */
export const useGenerateShiprocketLabel = (
  orderId: string,
  options?: UseMutationOptions<
    GenerateShiprocketLabelResponse,
    FetchError,
    GenerateShiprocketLabelVariables | undefined
  >
) => {
  return useMutation({
    mutationFn: (variables?: GenerateShiprocketLabelVariables) => {
      const body: Record<string, any> = {}
      if (variables?.preferred_courier_id) body.preferred_courier_id = variables.preferred_courier_id
      if (variables?.carrier) body.carrier = variables.carrier
      if (variables?.weight_grams) body.weight_grams = variables.weight_grams
      if (variables?.dimensions_cm) body.dimensions_cm = variables.dimensions_cm
      return sdk.client.fetch<GenerateShiprocketLabelResponse>(
        `/partners/orders/${orderId}/shiprocket-label`,
        { method: "POST", body }
      )
    },
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// ── Courier rates (#641 partner mirror) ───────────────────────────────────────

export type ShiprocketRateOption = {
  courier_id?: string | number
  courier_name?: string
  amount: number
  currency_code: string
  estimated_days?: number
  cod_charges?: number
  is_recommended?: boolean
}

export type ShiprocketRatesResponse = {
  origin_pincode: string
  destination_pincode: string
  weight_grams: number
  cod: boolean
  rates: ShiprocketRateOption[]
}

/**
 * List the carrier's courier options (rate / ETA / recommended) for one of the
 * partner's own orders, so the Mark-as-Shipped carrier step can show a picker
 * before generating the label. On-demand: pass `enabled` to fetch only when the
 * partner asks (the request hits the live carrier). `weightGrams` feeds the
 * quote from the parcel weight entered in the same step.
 */
export const usePartnerShiprocketRates = (
  orderId: string,
  query?: { carrier?: string; weightGrams?: number },
  options?: Omit<
    UseQueryOptions<ShiprocketRatesResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const params = new URLSearchParams()
  if (query?.carrier) params.set("carrier", query.carrier)
  if (query?.weightGrams) params.set("weight_grams", String(query.weightGrams))
  const qs = params.toString() ? `?${params.toString()}` : ""

  return useQuery({
    queryKey: [...ordersQueryKeys.detail(orderId), "shiprocket-rates", qs],
    queryFn: () =>
      sdk.client.fetch<ShiprocketRatesResponse>(
        `/partners/orders/${orderId}/shiprocket-rates${qs}`,
        { method: "GET" }
      ),
    ...options,
  })
}

// ── Carrier-neutral aliases (P4) ──────────────────────────────────────────────

export type GenerateFulfillmentLabelVariables = GenerateShiprocketLabelVariables
export type GenerateFulfillmentLabelResponse = GenerateShiprocketLabelResponse

/**
 * Carrier-neutral alias for `useGenerateShiprocketLabel`. Defaults carrier to
 * `"shiprocket"` when omitted on the backend.
 */
export const useGenerateFulfillmentLabel = (
  orderId: string,
  options?: UseMutationOptions<
    GenerateFulfillmentLabelResponse,
    FetchError,
    GenerateFulfillmentLabelVariables | undefined
  >
) => useGenerateShiprocketLabel(orderId, options)

export type AttachShiprocketAwbResponse = {
  shiprocket_awb: {
    awb: string
    current_status?: string
    synced_state: "delivered" | "shipped" | "pending"
    fulfillment_id: string
  }
}

/**
 * Attach an EXISTING Shiprocket AWB (parcel shipped outside this system) to one
 * of the partner's own orders. Read-only against Shiprocket — looks the AWB up,
 * stamps it onto the fulfillment, and syncs the fulfillment status.
 */
export const useAttachShiprocketAwb = (
  orderId: string,
  options?: UseMutationOptions<AttachShiprocketAwbResponse, FetchError, string>
) => {
  return useMutation({
    mutationFn: (awb: string) =>
      sdk.client.fetch<AttachShiprocketAwbResponse>(
        `/partners/orders/${orderId}/shiprocket-attach-awb`,
        { method: "POST", body: { awb } }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
