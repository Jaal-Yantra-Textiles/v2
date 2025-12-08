import { metaAdsKeys, ListLeadsParams } from "../../../hooks/api/meta-ads"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const leadsListQuery = (params: ListLeadsParams) => ({
  queryKey: metaAdsKeys.leadsList(params),
  queryFn: async () => {
    const query: Record<string, string> = {}
    if (params?.status) query.status = params.status
    if (params?.campaign_id) query.campaign_id = params.campaign_id
    if (params?.form_id) query.form_id = params.form_id
    if (params?.platform_id) query.platform_id = params.platform_id
    if (params?.since) query.since = params.since
    if (params?.until) query.until = params.until
    if (params?.q) query.q = params.q
    if (params?.limit) query.limit = params.limit.toString()
    if (params?.offset) query.offset = params.offset.toString()
    
    return sdk.client.fetch<any>(`/admin/meta-ads/leads`, { query })
  },
})

export const leadsLoader = async ({ params: _params }: any) => {
  // For list page, we don't have specific params from route
  // Just ensure the default query is cached
  const query = leadsListQuery({})
  return queryClient.ensureQueryData(query)
}
