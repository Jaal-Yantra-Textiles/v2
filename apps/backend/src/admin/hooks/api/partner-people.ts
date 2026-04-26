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
import { partnersQueryKeys } from "./partners-admin"

export interface PartnerPerson {
  id: string
  first_name: string
  last_name: string
  email: string | null
  state: string
  avatar: string | null
  created_at?: string
}

export interface PartnerPeopleResponse {
  people: PartnerPerson[]
  count: number
}

const PARTNER_PEOPLE_QUERY_KEY = "partner_people" as const
export const partnerPeopleQueryKeys = queryKeysFactory(PARTNER_PEOPLE_QUERY_KEY)

export const usePartnerPeople = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<PartnerPeopleResponse, FetchError, PartnerPeopleResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerPeopleResponse>(
        `/admin/partners/${partnerId}/people`,
        { method: "GET" }
      ),
    queryKey: partnerPeopleQueryKeys.detail(partnerId),
    ...options,
  })

  return {
    people: data?.people || [],
    count: data?.count || 0,
    ...rest,
  }
}

export interface LinkPeoplePayload {
  person_ids: string[]
}

export const useLinkPeopleToPartner = (
  partnerId: string,
  options?: UseMutationOptions<
    { partner_id: string; person_ids: string[]; linked: boolean },
    Error,
    LinkPeoplePayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      return sdk.client.fetch<{ partner_id: string; person_ids: string[]; linked: boolean }>(
        `/admin/partners/${partnerId}/people`,
        {
          method: "POST",
          body: payload,
        }
      )
    },
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: partnerPeopleQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.detail(partnerId) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useUnlinkPeopleFromPartner = (
  partnerId: string,
  options?: UseMutationOptions<
    { partner_id: string; person_ids: string[]; linked: boolean },
    Error,
    LinkPeoplePayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      return sdk.client.fetch<{ partner_id: string; person_ids: string[]; linked: boolean }>(
        `/admin/partners/${partnerId}/people`,
        {
          method: "DELETE",
          body: payload,
        }
      )
    },
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: partnerPeopleQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.detail(partnerId) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
