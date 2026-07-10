import { useMutation, UseMutationOptions } from "@tanstack/react-query"

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
