import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_SETTINGS_QUERY_KEY = "partner-settings" as const
export const partnerSettingsQueryKeys = queryKeysFactory(
  PARTNER_SETTINGS_QUERY_KEY
)

/**
 * The partner ORGANISATION (not the signed-in admin — that's `useMe`). Only the
 * fields the settings surfaces write are typed here; the route returns the
 * whole record.
 */
export type PartnerSettings = Record<string, any> & {
  id: string
  name?: string | null
  /**
   * #1228 — when a dispatch to this partner goes stale and the same run is
   * re-sent to them, accept it on their behalf instead of waiting for another
   * manual accept. A typed column, not metadata: it changes who owns the work.
   *
   * Consulted ONLY on a same-partner retry, and only when the platform's
   * reassignment policy has `auto_accept_on_retry` on — so switching this on
   * cannot make a partner auto-accept a FIRST dispatch, and cannot override the
   * platform being configured against it.
   */
  auto_accept_production_runs?: boolean
}

type PartnerDetailsResponse = {
  partner?: PartnerSettings | null
  current_admin_id?: string | null
}

export const usePartnerSettings = (
  options?: Omit<
    UseQueryOptions<
      PartnerDetailsResponse,
      FetchError,
      PartnerDetailsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerSettingsQueryKeys.details(),
    queryFn: async () =>
      await sdk.client.fetch<PartnerDetailsResponse>("/partners/details", {
        method: "GET",
      }),
    ...options,
  })

  return { partner: data?.partner ?? null, ...rest }
}

export type UpdatePartnerSettingsInput = {
  auto_accept_production_runs?: boolean
}

export const useUpdatePartnerSettings = (
  options?: UseMutationOptions<
    { partner: PartnerSettings },
    FetchError,
    UpdatePartnerSettingsInput
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{ partner: PartnerSettings }>(
        "/partners/update",
        {
          method: "PUT",
          body: payload,
        }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerSettingsQueryKeys.all,
      })
      // The signed-in user carries an embedded copy of the partner record.
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
