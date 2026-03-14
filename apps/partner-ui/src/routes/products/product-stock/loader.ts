import { defer, LoaderFunctionArgs } from "react-router-dom"
import { sdk } from "../../../lib/client"
import { getPartnerStoreId } from "../../../lib/partner-store-id"
import { PRODUCT_VARIANT_IDS_KEY } from "../common/constants"

async function getProductStockData(
  storeId: string,
  id: string,
  productVariantIds?: string[]
) {
  const { variants, count } = await sdk.client.fetch<{
    variants: any[]
    count: number
  }>(`/partners/stores/${storeId}/products/${id}/variants`, {
    method: "GET",
  })

  const { stock_locations } = await sdk.client.fetch<{
    stock_locations: any[]
  }>(`/partners/stores/${storeId}/locations`, {
    method: "GET",
  })

  return {
    variants: variants || [],
    locations: stock_locations || [],
  }
}

export const productStockLoader = async ({
  params,
  request,
}: LoaderFunctionArgs) => {
  const id = params.id!
  const storeId = await getPartnerStoreId()
  if (!storeId) {
    return defer({ data: Promise.resolve({ variants: [], locations: [] }) })
  }

  const searchParams = new URLSearchParams(request.url)
  const productVariantIds =
    searchParams.get(PRODUCT_VARIANT_IDS_KEY)?.split(",") || undefined

  const dataPromise = getProductStockData(storeId, id, productVariantIds)

  return defer({
    data: dataPromise,
  })
}
