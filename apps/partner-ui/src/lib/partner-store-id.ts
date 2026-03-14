import { sdk } from "./client"
import { queryClient } from "./query-client"
import {
  partnerStoresQueryKeys,
  PartnerStoresResponse,
} from "../hooks/api/partner-stores"

/**
 * Get the partner's primary storeId for use in route loaders
 * (which can't use React hooks). Reads from React Query cache first,
 * then falls back to a fresh fetch.
 */
export async function getPartnerStoreId(): Promise<string | null> {
  const cached = queryClient.getQueryData<PartnerStoresResponse>(
    partnerStoresQueryKeys.details()
  )
  if (cached?.stores?.[0]?.id) return cached.stores[0].id

  try {
    const data = await sdk.client.fetch<PartnerStoresResponse>(
      "/partners/stores",
      { method: "GET" }
    )
    queryClient.setQueryData(partnerStoresQueryKeys.details(), data)
    return data?.stores?.[0]?.id || null
  } catch {
    return null
  }
}
