import { useQuery } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/client"

/**
 * An inventory order this partner can bill us for — material we bought FROM
 * them, as opposed to work they did for us (#1710).
 *
 * 🔴 Every field the server sends is declared here. A flag the server has sent
 * for months with no entry in the client type has ZERO readers and reads as
 * absent forever (#1679) — which is how a screen ends up re-deriving a number
 * the route already computed correctly.
 */
export interface PayableInventoryOrder {
  inventory_order_id: string
  status: string | null
  is_sample: boolean
  currency_code: string | null
  /**
   * What was ORDERED. This is the write guard's ceiling — not the receipts
   * figure, which can legitimately sit above it.
   */
  ordered_total: number | null
  /** What the recorded RECEIPTS are worth, before any cap. */
  receipts_total: number
  received_quantity: number
  lines: Array<{
    material_name?: string | null
    received_quantity?: number
    price?: number
    total?: number
  }>
  /** Already billed across every live submission of this partner's. */
  claimed_total: number
  /** What may still be billed — `null` when the order has no readable price. */
  remaining: number | null
  /** What this row bills if selected. Read THIS for the money. */
  amount: number
  /** Whether `amount` is below `receipts_total` because the ceiling bit. */
  capped_by_ceiling: boolean
  /**
   * Money already PAID against this order (#1710).
   *
   * 🔴 The billable ceiling measures CLAIMS against the ordered total and has
   * no term for payments, so an order already settled but never billed is
   * offered here as freshly payable. Live on prod: INR 9,800 recorded since
   * March against INR 0 claimed, and this list offered INR 5,800 of it.
   */
  recorded_total: number
  /** Whether what has already been paid meets or exceeds what this row bills. */
  recorded_covers_amount: boolean
  order_date: string | null
  expected_delivery_date: string | null
  /**
   * Whether there is anything to bill. False means either no receipt has been
   * recorded — a gap in the record, not a price of zero — or the order is
   * already fully claimed.
   */
  payable: boolean
  claims: Array<{ submission_id: string | null; status: string | null }>
}

export interface PayableInventoryOrdersListResponse {
  payable_inventory_orders: PayableInventoryOrder[]
  count: number
}

export const usePartnerPayableInventoryOrders = (
  options?: Omit<
    UseQueryOptions<
      PayableInventoryOrdersListResponse,
      FetchError,
      PayableInventoryOrdersListResponse,
      ["partner-payable-inventory-orders"]
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["partner-payable-inventory-orders"] as const,
    queryFn: async () => {
      return await sdk.client.fetch<PayableInventoryOrdersListResponse>(
        "/partners/payment-submissions/payable-inventory-orders",
        { method: "GET" }
      )
    },
    ...options,
  })

  /**
   * 🔴 Spread the payload, for the same reason `usePartnerPayableRuns` does:
   * returning the raw `useQuery` result gives the caller `{ data, … }`, so
   * destructuring `payable_inventory_orders` finds nothing, falls back to `[]`,
   * and the screen renders "no inventory orders to bill" forever — with a 200
   * and a full payload sitting in `data`.
   */
  return {
    ...data,
    payable_inventory_orders: data?.payable_inventory_orders ?? [],
    ...rest,
  }
}
