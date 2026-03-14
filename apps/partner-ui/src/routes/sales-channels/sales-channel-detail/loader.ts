import { LoaderFunctionArgs } from "react-router-dom"

import { salesChannelsQueryKeys } from "../../../hooks/api/sales-channels"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const salesChannelDetailQuery = (storeId: string, id: string) => ({
  queryKey: salesChannelsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ sales_channel: any }>(
      `/partners/stores/${storeId}/sales-channels/${id}`,
      { method: "GET" }
    ),
})

export const salesChannelLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = salesChannelDetailQuery(storeId, id!)

  return queryClient.ensureQueryData(query)
}
