import { LoaderFunctionArgs } from "react-router-dom"

import { variantsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"
import { VARIANT_DETAIL_FIELDS } from "./constants"

const variantDetailQuery = (productId: string, variantId: string, storeId: string) => ({
  queryKey: variantsQueryKeys.detail(variantId, {
    fields: VARIANT_DETAIL_FIELDS,
  }),
  queryFn: async () =>
    sdk.client.fetch<{ variant: any }>(
      `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
      { method: "GET" }
    ),
})

export const variantLoader = async ({ params }: LoaderFunctionArgs) => {
  try {
    const productId = params.id
    const variantId = params.variant_id

    if (!productId || !variantId) {
      return undefined
    }

    const storeId = await getPartnerStoreId()
    if (!storeId) {
      return undefined
    }

    const query = variantDetailQuery(productId, variantId, storeId)
    return await queryClient.ensureQueryData(query)
  } catch {
    return undefined
  }
}
