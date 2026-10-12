import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

/**
 * #2322 — profit share on a partner run made with OUR material, for the ADMIN
 * dashboard. The partner pays us a share of the GROSS sale price of every
 * piece they sell; we record their sales and the bank/cash payments they make.
 */

export type ProfitShareSale = {
  id: string
  quantity: number
  unit_price: number
  currency_code: string
  sold_at: string
  note: string | null
  reported_by: "admin" | "partner"
}

export type ProfitShareSettlement = {
  id: string
  amount: number
  currency_code: string
  method: "bank_transfer" | "cash"
  paid_at: string
  reference: string | null
  note: string | null
}

export type ProfitShareSummary = {
  percent: number | null
  currency_code: string
  run_quantity: number | null
  sold_quantity: number
  unsold_quantity: number | null
  gross_sales: number
  /** null = no arrangement on this run (never read it as 0). */
  owed: number | null
  paid: number
  balance: number | null
  status: "none" | "no_sales" | "open" | "settled" | "overpaid"
  currency_mismatch: boolean
  working: string[]
}

export type ProfitShare = {
  production_run_id: string
  partner_id: string | null
  percent: number | null
  sales: ProfitShareSale[]
  settlements: ProfitShareSettlement[]
  summary: ProfitShareSummary
}

const key = (runId: string) => ["production-run-profit-share", runId] as const

export const useProductionRunProfitShare = (runId: string) =>
  useQuery({
    queryKey: key(runId),
    queryFn: () =>
      sdk.client.fetch<{ profit_share: ProfitShare }>(
        `/admin/production-runs/${runId}/profit-share`
      ),
    enabled: !!runId,
  })

const useProfitShareMutation = <TBody>(
  runId: string,
  build: (body: TBody) => { path: string; method: "POST" | "DELETE"; body?: unknown }
) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TBody) => {
      const req = build(body)
      return sdk.client.fetch<{ profit_share: ProfitShare }>(req.path, {
        method: req.method,
        ...(req.body !== undefined ? { body: req.body } : {}),
      })
    },
    onSuccess: (data) => {
      qc.setQueryData(key(runId), { profit_share: data.profit_share })
    },
  })
}

const base = (runId: string) => `/admin/production-runs/${runId}/profit-share`

export const useSetProfitSharePercent = (runId: string) =>
  useProfitShareMutation<{ percent: number | null }>(runId, (body) => ({
    path: base(runId),
    method: "POST",
    body,
  }))

export const useRecordProfitShareSale = (runId: string) =>
  useProfitShareMutation<{ quantity: number; unit_price: number; sold_at?: string; note?: string }>(
    runId,
    (body) => ({ path: `${base(runId)}/sales`, method: "POST", body })
  )

export const useDeleteProfitShareSale = (runId: string) =>
  useProfitShareMutation<string>(runId, (saleId) => ({
    path: `${base(runId)}/sales/${saleId}`,
    method: "DELETE",
  }))

export const useRecordProfitSharePayment = (runId: string) =>
  useProfitShareMutation<{
    amount: number
    method: "bank_transfer" | "cash"
    paid_at?: string
    reference?: string
    note?: string
  }>(runId, (body) => ({ path: `${base(runId)}/settlements`, method: "POST", body }))

export const useDeleteProfitSharePayment = (runId: string) =>
  useProfitShareMutation<string>(runId, (settlementId) => ({
    path: `${base(runId)}/settlements/${settlementId}`,
    method: "DELETE",
  }))
