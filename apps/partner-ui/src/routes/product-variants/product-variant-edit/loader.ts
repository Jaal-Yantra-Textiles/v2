import { LoaderFunctionArgs } from "react-router-dom"

import { variantsQueryKeys } from "../../../hooks/api/products"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"

const queryFn = async (productId: string, variantId: string, storeId: string) => {
  return await sdk.client.fetch<{ variant: any }>(
    `/partners/stores/${storeId}/products/${productId}/variants/${variantId}`,
    { method: "GET" }
  )
}

const editProductVariantQuery = (productId: string, variantId: string, storeId: string) => ({
  queryKey: variantsQueryKeys.detail(variantId),
  queryFn: async () => queryFn(productId, variantId, storeId),
})

export const editProductVariantLoader = async ({
  params,
  request,
}: LoaderFunctionArgs) => {
  try {
    const id = params.id
    const searchParams = new URL(request.url).searchParams
    const searchVariantId = searchParams.get("variant_id")
    const variantId = params.variant_id || searchVariantId

    if (!variantId || !id) {
      return undefined
    }

    const storeId = await getPartnerStoreId()
    if (!storeId) {
      return undefined
    }

    const query = editProductVariantQuery(id, variantId, storeId)
    return (
      queryClient.getQueryData<ReturnType<typeof queryFn>>(query.queryKey) ??
      (await queryClient.fetchQuery(query))
    )
  } catch {
    return undefined
  }
}
