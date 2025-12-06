import { campaignKeys, Campaign } from "../../../hooks/api/publishing-campaigns"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const campaignDetailQuery = (id: string) => ({
  queryKey: campaignKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ campaign: Campaign }>(`/admin/publishing-campaigns/${id}`, {
      method: "GET",
    }),
})

export const campaignLoader = async ({ params }: any) => {
  const id = params.id
  const query = campaignDetailQuery(id!)

  const data = await queryClient.ensureQueryData(query)
  
  // Return the campaign data for use as initialData
  return data.campaign
}
