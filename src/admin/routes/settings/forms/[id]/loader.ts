import { formsQueryKeys } from "../../../../hooks/api/forms"
import { sdk } from "../../../../lib/config"
import { queryClient } from "../../../../lib/query-client"

const formDetailQuery = (id: string) => ({
  queryKey: formsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ form: any }>(`/admin/forms/${id}`, {
      method: "GET",
    }),
})

export const formLoader = async ({ params }: any) => {
  const id = params.id
  const query = formDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
