import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { useMe } from "./users"

// Company / Platform overview + investor referrals (invite friends).

export type TeamMember = {
  id: string
  name: string
  ownership_percentage?: number | null
  is_me?: boolean
}

export type CompanyProfile = {
  tagline?: string | null
  github_url?: string | null
  pitch_deck_url?: string | null
  links?: Array<{ label?: string; url?: string }>
  highlights?: string[]
}

export type MyCompany = {
  id: string
  name: string
  legal_name?: string | null
  website?: string | null
  logo_url?: string | null
  industry?: string | null
  description?: string | null
  founded_date?: string | null
  status?: string
  profile: CompanyProfile
  team: TeamMember[]
}

export type Referral = {
  id: string
  name: string
  email: string
  note?: string | null
  access_level: "view_only" | "investor"
  status: "invited" | "contacted" | "joined" | "declined"
  created_at?: string
}

export const useMyCompanies = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ companies: MyCompany[]; count: number }>(
        "/investors/me/companies"
      ),
    queryKey: ["investor-companies"],
  })
  return { ...data, ...rest }
}

export const useMyReferrals = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ referrals: Referral[]; count: number }>(
        "/investors/me/referrals"
      ),
    queryKey: ["investor-referrals"],
  })
  return { ...data, ...rest }
}

export type CreateReferralPayload = {
  name: string
  email: string
  note?: string | null
  access_level: "view_only" | "investor"
}

export const useCreateReferral = (
  options?: UseMutationOptions<
    { referral: Referral },
    FetchError,
    CreateReferralPayload
  >
) => {
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch("/investors/me/referrals", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["investor-referrals"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// A view-only investor can browse the portal but not participate in deals. The
// access level is carried on the investor's metadata (set when the team
// onboards a referred view-only invitee). Defaults to full investor when unset,
// so existing investors are unaffected.
export const useIsViewOnly = (): boolean => {
  const { user } = useMe()
  return (user as any)?.metadata?.access_level === "view_only"
}
