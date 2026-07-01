import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const groupDetailQuery = (id: string) => ({
  queryKey: ["raw-material-groups", "detail", id],
  queryFn: async () =>
    sdk.client.fetch<{ raw_material_group: any }>(
      `/admin/raw-material-groups/${id}`,
      { method: "GET" }
    ),
})

export const groupLoader = async ({ params }: any) => {
  const id = params.id
  return queryClient.ensureQueryData(groupDetailQuery(id!))
}
