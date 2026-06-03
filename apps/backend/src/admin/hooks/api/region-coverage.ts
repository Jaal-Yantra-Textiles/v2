import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type RegionPartnerCoverage = {
  region: { id: string; name: string; currency_code: string }
  total_partners: number
  linked_partners: number
  unlinked_partners: Array<{ id: string; name: string }>
}

const coverageKey = (regionId: string) =>
  ["region-partner-coverage", regionId] as const

export const useRegionPartnerCoverage = (regionId: string) =>
  useQuery({
    queryKey: coverageKey(regionId),
    enabled: !!regionId,
    queryFn: () =>
      sdk.client.fetch<RegionPartnerCoverage>(
        `/admin/regions/${regionId}/partner-coverage`,
        { method: "GET" }
      ),
  })

export type ShareToAllResult = {
  result: {
    region_id: string
    links_created: number
    links_already_existing: number
    stores_currency_updated: number
    stores_currency_already_current: number
    fanout_invocations: number
    fanout_created_prices: number
    fanout_errors: number
    errors: Array<{ partner_id: string; phase: string; error: string }>
  }
}

export const useShareRegionToAllPartners = (regionId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { trigger_fanout?: boolean; partner_ids?: string[] }) =>
      sdk.client.fetch<ShareToAllResult>(
        `/admin/regions/${regionId}/share-to-all`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: coverageKey(regionId) })
    },
  })
}
