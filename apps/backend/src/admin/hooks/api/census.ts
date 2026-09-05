import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { AdminWeaver } from "./personandtype"

export interface CensusState {
  state: string
  count: number | null
}

/** A single weaver's MASKED census record, for the weaver detail view. */
export const useWeaver = (
  censusId: string | number | undefined,
  options?: Omit<
    UseQueryOptions<{ weaver: AdminWeaver }, FetchError, { weaver: AdminWeaver }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: ["census", "weaver", censusId],
    queryFn: async () =>
      sdk.client.fetch<{ weaver: AdminWeaver }>(`/admin/census/weavers/${censusId}`),
    enabled: censusId !== undefined && censusId !== null && censusId !== "",
    ...options,
  })
}

/** Every geographic state in the census (from the aggregates). */
export const useCensusStates = (
  options?: Omit<
    UseQueryOptions<{ states: CensusState[] }, FetchError, { states: CensusState[] }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["census", "states"],
    queryFn: async () => sdk.client.fetch<{ states: CensusState[] }>(`/admin/census/states`),
    staleTime: 5 * 60 * 1000,
    ...options,
  })
  return { states: data?.states, ...rest }
}