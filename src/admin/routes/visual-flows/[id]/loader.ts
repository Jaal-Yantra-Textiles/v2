import { visualFlowQueryKeys } from "../../../hooks/api/visual-flows"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"

const visualFlowDetailQuery = (id: string) => ({
  queryKey: visualFlowQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ flow: any }>(`/admin/visual-flows/${id}`, {
      method: "GET",
    }),
})

export const visualFlowLoader = async ({ params }: any) => {
  const id = params.id
  const query = visualFlowDetailQuery(id!)

  const response = await queryClient.ensureQueryData({
    ...query,
  })

  return response
}
