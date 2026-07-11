import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const ONBOARDING_PROFILE_QUERY_KEY = "onboarding_profile" as const
export const onboardingProfileQueryKeys = queryKeysFactory(
  ONBOARDING_PROFILE_QUERY_KEY
)

export type PartnerOnboardingProfile = {
  id?: string
  partner_id?: string
  selling_mode?: "dedicated_storefront" | "core_channel_listing" | null
  commission_bps?: number | null
  supplies_to_platform?: boolean | null
  [key: string]: any
} | null

// #859 S3 (#862): read the partner's onboarding profile — used to gate the
// artisan (made-to-order) UI to `core_channel_listing` sellers.
export const usePartnerOnboardingProfile = (
  options?: Omit<
    UseQueryOptions<
      { onboarding_profile: PartnerOnboardingProfile },
      FetchError,
      { onboarding_profile: PartnerOnboardingProfile },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: onboardingProfileQueryKeys.details(),
    queryFn: () =>
      sdk.client.fetch<{ onboarding_profile: PartnerOnboardingProfile }>(
        "/partners/onboarding-profile",
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}
