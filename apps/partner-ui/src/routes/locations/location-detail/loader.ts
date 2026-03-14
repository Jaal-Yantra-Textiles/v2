import { LoaderFunctionArgs } from "react-router-dom"

import { stockLocationsQueryKeys } from "../../../hooks/api/stock-locations"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const locationQuery = (storeId: string, id: string) => ({
  queryKey: stockLocationsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ stock_location: any }>(
      `/partners/stores/${storeId}/locations/${id}`,
      { method: "GET" }
    ),
})

export const locationLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.location_id
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = locationQuery(storeId, id!)

  return queryClient.ensureQueryData(query)
}
