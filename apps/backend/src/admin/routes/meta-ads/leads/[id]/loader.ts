import { metaAdsKeys, Lead } from "../../../../hooks/api/meta-ads"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"

const leadDetailQuery = (id: string) => ({
  queryKey: metaAdsKeys.leadDetail(id),
  queryFn: async () =>
    sdk.client.fetch<{ lead: Lead }>(`/admin/meta-ads/leads/${id}`),
})

export const leadDetailLoader = async ({ params }: any) => {
  const id = params.id
  const query = leadDetailQuery(id!)
  return queryClient.ensureQueryData(query)
}
