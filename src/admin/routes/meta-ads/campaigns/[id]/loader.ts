import { metaAdsKeys, AdCampaign } from "../../../../hooks/api/meta-ads"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"

const campaignDetailQuery = (id: string) => ({
  queryKey: metaAdsKeys.campaignDetail(id),
  queryFn: async () =>
    sdk.client.fetch<{ campaign: AdCampaign }>(`/admin/meta-ads/campaigns/${id}`),
})

export const campaignDetailLoader = async ({ params }: any) => {
  const id = params.id
  const query = campaignDetailQuery(id!)
  return queryClient.ensureQueryData(query)
}
