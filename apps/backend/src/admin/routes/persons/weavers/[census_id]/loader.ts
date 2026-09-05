import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"

export const weaverLoader = async ({ params }: any) => {
  const censusId = params.census_id

  return queryClient.ensureQueryData({
    queryKey: ["census", "weaver", censusId],
    queryFn: async () =>
      sdk.client.fetch<{ weaver: any }>(`/admin/census/weavers/${censusId}`),
  })
}