import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PLUGINS_QUERY_KEY = "plugins" as const
export const pluginsQueryKeys = queryKeysFactory(PLUGINS_QUERY_KEY)

// `/admin/plugins` is not exposed to partner auth, so the SDK call
// `sdk.admin.plugin.list()` 401s in the partner-ui. Until we either
// proxy a partner-scoped variant or remove plugin-aware UI bits
// (loyalty badge on refund + payment summary), the hook returns an
// empty list so consumers degrade gracefully without firing a request.
export const usePlugins = (
  _options?: Omit<
    UseQueryOptions<
      any,
      FetchError,
      HttpTypes.AdminPluginsListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery<HttpTypes.AdminPluginsListResponse>({
    queryFn: async () => ({ plugins: [] }),
    queryKey: pluginsQueryKeys.list(),
    staleTime: Infinity,
  })

  return { ...data, ...rest }
}
