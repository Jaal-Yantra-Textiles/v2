import { useQuery } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/client"

export interface PayableRun {
  run_id: string
  design_id: string
  design_name: string | null
  design_status: string | null
  completed_at: string | null
  ordered_quantity: number | null
  produced_quantity: number | null
  rejected_quantity: number | null
  payable_quantity: number
  quantity_basis: "produced" | "ordered"
  unit_amount: number
  amount: number
  cost_type: string | null
  partner_cost_estimate: number | null
  payable: boolean
  design_estimated_cost: number | null
  design_production_cost: number | null
  billed: {
    submission_id: string
    status: string
    quantity: number
  } | null
  unrecorded_claims: Array<{
    submission_id: string
    status: string
    amount: number
  }>
  design_has_open_submission: boolean
  billing_status: "clear" | "unknown" | "billed"
}

export interface PayableRunsListResponse {
  payable_runs: PayableRun[]
  count: number
}

export const usePartnerPayableRuns = (
  options?: Omit<
    UseQueryOptions<
      PayableRunsListResponse,
      FetchError,
      PayableRunsListResponse,
      ["partner-payable-runs"]
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery<PayableRunsListResponse, FetchError>(
    {
      queryKey: ["partner-payable-runs"],
      queryFn: async () => {
        return await sdk.client.fetch<PayableRunsListResponse>(
          "/partners/payment-submissions/payable-runs",
          {
            method: "GET",
          }
        )
      },
      ...options,
    }
  )
}
