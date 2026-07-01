import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

export type DesignWorkOrderRow = {
  id: string
  display_id?: number
  status: string
  created_at: string
  currency_code?: string
  has_customer: boolean
  partner_status?: string | null
  source_order_id?: string | null
  design_count: number
  runs: any[]
}

export type DesignWorkOrdersResponse = {
  design_work_orders: DesignWorkOrderRow[]
  designs: Record<string, any>
  partners: Record<string, string>
  count: number
  limit: number
  offset: number
}

const DESIGN_WORK_ORDERS_QUERY_KEY = "design-work-orders" as const

export const useDesignWorkOrders = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      DesignWorkOrdersResponse,
      FetchError,
      DesignWorkOrdersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [DESIGN_WORK_ORDERS_QUERY_KEY, query],
    queryFn: async () =>
      sdk.client.fetch<DesignWorkOrdersResponse>(`/admin/design-work-orders`, {
        method: "GET",
        query,
      }),
    ...options,
  })

  return {
    design_work_orders: data?.design_work_orders ?? [],
    designs: data?.designs ?? {},
    partners: data?.partners ?? {},
    count: data?.count ?? 0,
    ...rest,
  }
}
