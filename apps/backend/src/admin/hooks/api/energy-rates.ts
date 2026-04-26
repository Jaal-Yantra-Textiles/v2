import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

const ENERGY_RATES_QUERY_KEY = "energy-rates" as const
export const energyRateQueryKeys = queryKeysFactory(ENERGY_RATES_QUERY_KEY)

export type AdminEnergyRate = {
  id: string
  name: string
  energy_type: "energy_electricity" | "energy_water" | "energy_gas" | "labor"
  unit_of_measure: "kWh" | "Liter" | "Cubic_Meter" | "Hour" | "Other"
  rate_per_unit: number
  currency: string
  effective_from: string
  effective_to: string | null
  region: string | null
  is_active: boolean
  notes: string | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export type AdminEnergyRatesResponse = {
  energy_rates: AdminEnergyRate[]
  count: number
}

export type AdminEnergyRateResponse = {
  energy_rate: AdminEnergyRate
}

export type AdminCreateEnergyRatePayload = {
  name: string
  energyType: string
  unitOfMeasure?: string
  ratePerUnit: number
  currency?: string
  effectiveFrom: string
  effectiveTo?: string | null
  region?: string | null
  isActive?: boolean
  notes?: string | null
  metadata?: Record<string, any> | null
}

export type AdminUpdateEnergyRatePayload = Partial<AdminCreateEnergyRatePayload>

// --- Queries ---

export const useEnergyRates = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<AdminEnergyRatesResponse, FetchError, AdminEnergyRatesResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: energyRateQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminEnergyRatesResponse>(`/admin/energy-rates`, {
        method: "GET",
        query,
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useEnergyRate = (
  id: string,
  options?: Omit<
    UseQueryOptions<AdminEnergyRateResponse, FetchError, AdminEnergyRateResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: energyRateQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminEnergyRateResponse>(`/admin/energy-rates/${id}`, {
        method: "GET",
      }),
    ...options,
  })

  return { ...data, ...rest }
}

// --- Mutations ---

export const useCreateEnergyRate = (
  options?: UseMutationOptions<AdminEnergyRateResponse, FetchError, AdminCreateEnergyRatePayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminCreateEnergyRatePayload) =>
      sdk.client.fetch<AdminEnergyRateResponse>(`/admin/energy-rates`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mr, context) => {
      queryClient.invalidateQueries({ queryKey: energyRateQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mr, context)
    },
    ...options,
  })
}

export const useUpdateEnergyRate = (
  id: string,
  options?: UseMutationOptions<AdminEnergyRateResponse, FetchError, AdminUpdateEnergyRatePayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminUpdateEnergyRatePayload) =>
      sdk.client.fetch<AdminEnergyRateResponse>(`/admin/energy-rates/${id}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, _mr, context) => {
      queryClient.invalidateQueries({ queryKey: energyRateQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: energyRateQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mr, context)
    },
    ...options,
  })
}

export const useDeleteEnergyRate = (
  id: string,
  options?: UseMutationOptions<{ id: string; deleted: boolean }, FetchError, void>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(`/admin/energy-rates/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, _mr, context) => {
      queryClient.invalidateQueries({ queryKey: energyRateQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mr, context)
    },
    ...options,
  })
}
