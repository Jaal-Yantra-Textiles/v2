import { HttpTypes } from "@medusajs/types"
import { LoaderFunctionArgs } from "react-router-dom"
import { regionsQueryKeys } from "../../../hooks/api/regions"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const regionQuery = (storeId: string, id: string) => ({
  queryKey: regionsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ region: any }>(
      `/partners/stores/${storeId}/regions/${id}`,
      { method: "GET" }
    ),
})

export const regionLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = regionQuery(storeId, id!)

  return (
    queryClient.getQueryData<{ region: HttpTypes.AdminRegion }>(
      query.queryKey
    ) ?? (await queryClient.fetchQuery(query))
  )
}
