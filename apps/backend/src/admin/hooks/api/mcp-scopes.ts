import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * Admin MCP per-credential scopes (#1306 Track C).
 *
 * The two env flags are a process-wide CEILING; a row here narrows ONE
 * credential below it. Effective level is `min(ceiling, row)`, and no row means
 * the ceiling — so deleting a row WIDENS rather than revokes.
 */

export const MCP_SCOPE_LEVELS = [
  "read",
  "write",
  "sensitive",
  "dangerous",
] as const

export type McpScopeLevel = (typeof MCP_SCOPE_LEVELS)[number]

export type AdminMcpScope = {
  id: string
  principal_type: string
  principal_id: string
  level: McpScopeLevel
  label?: string | null
  note?: string | null
  created_at: Date
  updated_at: Date
}

export type AdminMcpScopeLevelCount = {
  level: McpScopeLevel
  tools: number
}

export type AdminMcpScopesResponse = {
  scopes: AdminMcpScope[]
  ceiling: McpScopeLevel
  levels: AdminMcpScopeLevelCount[]
}

export type AdminSetMcpScopePayload = {
  principal_type: string
  principal_id: string
  level: McpScopeLevel
  label?: string | null
  note?: string | null
}

export type AdminSetMcpScopeResponse = {
  scope: AdminMcpScope
  effective_level: McpScopeLevel
  ceiling: McpScopeLevel
  tools_visible: number
  /** Present only when the row asks for more than the ceiling allows. */
  warning?: string
  tools_by_level: Record<McpScopeLevel, number>
}

const MCP_SCOPES_QUERY_KEY = "mcp_access_scopes" as const
export const mcpScopesQueryKeys = queryKeysFactory(MCP_SCOPES_QUERY_KEY)

export const useMcpScopes = () => {
  const { data, ...rest } = useQuery({
    queryKey: mcpScopesQueryKeys.list(),
    queryFn: async () =>
      sdk.client.fetch<AdminMcpScopesResponse>("/admin/mcp/scopes", {
        method: "GET",
      }),
  })

  return {
    ...rest,
    scopes: data?.scopes,
    ceiling: data?.ceiling,
    levels: data?.levels,
  }
}

/**
 * Upsert — the backend keys on (principal_type, principal_id), so re-scoping a
 * credential is one call rather than delete-then-create. There is therefore no
 * window in which it briefly holds the ceiling instead.
 */
export const useSetMcpScope = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminSetMcpScopePayload) =>
      sdk.client.fetch<AdminSetMcpScopeResponse>("/admin/mcp/scopes", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      // `lists()` is the PREFIX ([key, "list"]); `list()` appends a `{query}`
      // object, so invalidating with it would miss the query above.
      queryClient.invalidateQueries({ queryKey: mcpScopesQueryKeys.lists() })
    },
  })
}

export const useDeleteMcpScope = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/admin/mcp/scopes/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      // `lists()` is the PREFIX ([key, "list"]); `list()` appends a `{query}`
      // object, so invalidating with it would miss the query above.
      queryClient.invalidateQueries({ queryKey: mcpScopesQueryKeys.lists() })
    },
  })
}

export type AdminSecretApiKey = {
  id: string
  title: string
  type: string
  revoked_at?: string | null
}

/**
 * Secret API keys, for the credential picker.
 *
 * ⚠️ `principal_id` is the key ID (`apk_…`), never the token — a row keyed on a
 * token silently never matches. Picking from a list removes that whole class of
 * mistake, so the free-text field is only a fallback for `oauth`/`user`.
 */
export const useSecretApiKeys = (enabled: boolean) => {
  const { data, ...rest } = useQuery({
    queryKey: [MCP_SCOPES_QUERY_KEY, "api-keys"],
    queryFn: async () =>
      sdk.client.fetch<{ api_keys: AdminSecretApiKey[] }>(
        "/admin/api-keys?limit=100",
        { method: "GET" }
      ),
    enabled,
  })

  return {
    ...rest,
    apiKeys: (data?.api_keys || []).filter(
      (k) => k.type === "secret" && !k.revoked_at
    ),
  }
}
