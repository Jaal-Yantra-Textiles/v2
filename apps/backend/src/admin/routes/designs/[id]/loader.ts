import { designQueryKeys } from "../../../hooks/api/designs";
import { sdk } from "../../../lib/config";
import { queryClient } from "../../../lib/query-client";
import { DESIGN_DETAIL_FIELDS } from "./constants";

const designDetailQuery = (id: string) => ({
  queryKey: designQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ design: any }>(`/admin/designs/${id}`, {
      method: "GET",
      query: {
        fields: DESIGN_DETAIL_FIELDS,
      },
    }),
})

export const designLoader = async ({ params }: any) => {
  const id = params.id
  const query = designDetailQuery(id!)

  const response = await queryClient.ensureQueryData({
    ...query,
  })

  return response
}
