import { partnersQueryKeys } from "../../../hooks/api/partners-admin"
import { sdk } from "../../../lib/config"
import { queryClient } from "../../../lib/query-client"
import { PARTNER_DETAIL_FIELDS } from "./constants"

const partnerDetailQuery = (id: string) => ({
  queryKey: partnersQueryKeys.detail(id, { fields: ["*", "admins.*"] }),
  queryFn: async () =>
    sdk.client.fetch<{ partner: any }>(`/admin/partners/${id}`, {
      method: "GET",
      query: {
        fields: PARTNER_DETAIL_FIELDS,
      },
    }),
})

export const partnerLoader = async ({ params }: any) => {
  const id = params.id as string
  const query = partnerDetailQuery(id)
  return queryClient.ensureQueryData(query)
}
