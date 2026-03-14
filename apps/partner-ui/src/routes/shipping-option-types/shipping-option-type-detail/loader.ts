import { LoaderFunctionArgs } from "react-router-dom"

import { shippingOptionTypesQueryKeys } from "../../../hooks/api/shipping-option-types"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

const shippingOptionTypeDetailQuery = (id: string) => ({
  queryKey: shippingOptionTypesQueryKeys.detail(id),
  queryFn: async () =>
    sdk.client.fetch<{ shipping_option_type: any }>(
      `/partners/shipping-option-types/${id}`,
      { method: "GET" }
    ),
})

export const shippingOptionTypeLoader = async ({
  params,
}: LoaderFunctionArgs) => {
  const id = params.id
  const query = shippingOptionTypeDetailQuery(id!)

  return queryClient.ensureQueryData(query)
}
