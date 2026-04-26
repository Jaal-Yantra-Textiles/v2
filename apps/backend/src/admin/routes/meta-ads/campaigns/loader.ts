import { metaAdsKeys, ListCampaignsParams } from "../../../hooks/api/meta-ads"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const campaignsListQuery = (params: ListCampaignsParams) => ({
  queryKey: metaAdsKeys.campaignsList(params),
  queryFn: async () => {
    const queryParams = new URLSearchParams()
    if (params?.ad_account_id) queryParams.set("ad_account_id", params.ad_account_id)
    if (params?.status) queryParams.set("status", params.status)
    if (params?.limit) queryParams.set("limit", params.limit.toString())
    if (params?.offset) queryParams.set("offset", params.offset.toString())
    
    const queryString = queryParams.toString()
    const url = queryString ? `/admin/meta-ads/campaigns?${queryString}` : `/admin/meta-ads/campaigns`
    
    return sdk.client.fetch<any>(url)
  },
})

export const adsCampaignLoader = async ({ params: _params }: any) => {
  // For list page, we don't have specific params from route
  // Just ensure the default query is cached
  const query = campaignsListQuery({})
  return queryClient.ensureQueryData(query)
}
