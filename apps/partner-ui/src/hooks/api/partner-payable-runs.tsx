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
  billing_status: "clear" | "partly_billed" | "unknown" | "billed"
  /**
   * Units still billable on this run (#1596), or null when there is no
   * arithmetic behind the answer — which is exactly when the write guard
   * refuses. A number here is a promise `create` will keep.
   */
  billable_remaining: number | null
  /**
   * #1676 — no agreed quantity, so nothing caps what may be billed against
   * this run. A null `billable_remaining` beside this means "no ceiling", not
   * "nothing left".
   */
  open_ended: boolean
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
  const { data, ...rest } = useQuery({
    queryKey: ["partner-payable-runs"] as const,
    queryFn: async () => {
      return await sdk.client.fetch<PayableRunsListResponse>(
        "/partners/payment-submissions/payable-runs",
        { method: "GET" }
      )
    },
    ...options,
  })

  /**
   * 🔴 Spread the payload, exactly as `usePartnerDesigns` does. Returning the
   * raw `useQuery` result instead gives the caller `{ data, isPending, … }`,
   * so `const { payable_runs = [] } = usePartnerPayableRuns()` destructures a
   * property that does not exist, silently falls back to `[]`, and the screen
   * renders "no payable production runs" forever — with a 200 and a full
   * payload sitting in `data`. The empty state is indistinguishable from a
   * partner who genuinely has no runs.
   */
  return {
    ...data,
    payable_runs: data?.payable_runs ?? [],
    ...rest,
  }
}
