import { LoaderFunctionArgs } from "react-router-dom"
import { taxRegionsQueryKeys } from "../../../hooks/api/tax-regions"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const taxRegionDetailQuery = (storeId: string, id: string) => ({
  queryKey: taxRegionsQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ tax_region: any }>(
      `/partners/stores/${storeId}/tax-regions/${id}`,
      { method: "GET" }
    ),
})

export const taxRegionLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id
  const storeId = await getPartnerStoreId()
  if (!storeId) return null

  const query = taxRegionDetailQuery(storeId, id!)

  return queryClient.ensureQueryData(query)
}
