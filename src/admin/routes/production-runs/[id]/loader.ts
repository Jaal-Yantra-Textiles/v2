import { productionRunQueryKeys } from "../../../hooks/api/production-runs"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const productionRunDetailQuery = (id: string) => ({
  queryKey: productionRunQueryKeys.detail(id, {}),
  queryFn: async () =>
    sdk.client.fetch<{ production_run: any; tasks: any[] }>(
      `/admin/production-runs/${id}`,
      {
        method: "GET",
      }
    ),
})

export const productionRunLoader = async ({ params }: any) => {
  const id = params.id as string
  const query = productionRunDetailQuery(id)
  return queryClient.ensureQueryData(query)
}
