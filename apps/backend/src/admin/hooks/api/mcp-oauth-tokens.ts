import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"
import type {
  AdminMcpOauthToken,
  AdminUserSummary,
} from "../../lib/mcp-oauth-token-state"

/**
 * OAuth authorizations issued by the Admin MCP front door (#1306 Track B).
 *
 * The counterpart to `/admin/mcp/scopes`: that says what a credential MAY do,
 * this says which credentials EXIST and who let them in.
 *
 * ⚠️ Every one of these is a Medusa **user JWT** carrying an `mcp_oauth` claim —
 * the framework 401s any other actor type on `/admin/*`, so no other shape was
 * available. The consequence is worth showing an admin plainly: an
 * authorization acts AS a person, and everything it does is attributed to them.
 *
 * The pure read-model lives in lib/mcp-oauth-token-state; this file is only the
 * transport.
 */

export type {
  AdminMcpOauthToken,
  AdminUserSummary,
  TokenState,
} from "../../lib/mcp-oauth-token-state"
export { describeUser, tokenState } from "../../lib/mcp-oauth-token-state"

const MCP_OAUTH_TOKENS_QUERY_KEY = "mcp_oauth_tokens" as const
export const mcpOauthTokenQueryKeys = queryKeysFactory(
  MCP_OAUTH_TOKENS_QUERY_KEY
)

export const useMcpOauthTokens = () => {
  const { data, ...rest } = useQuery({
    queryKey: mcpOauthTokenQueryKeys.list(),
    queryFn: async () =>
      sdk.client.fetch<{ tokens: AdminMcpOauthToken[] }>(
        "/admin/mcp/oauth-tokens",
        { method: "GET" }
      ),
  })

  return { ...rest, tokens: data?.tokens }
}

/**
 * Revoke one authorization.
 *
 * Takes effect on the NEXT request, reads included — the access token is a
 * self-verifying JWT, and what makes revocation immediate is the `/admin/*`
 * global that reads this row on every request carrying an `mcp_oauth` claim.
 */
export const useRevokeMcpOauthToken = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) =>
      sdk.client.fetch<{ id: string; revoked: boolean }>(
        `/admin/mcp/oauth-tokens/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      // `lists()` is the PREFIX ([key, "list"]); `list()` appends a `{query}`
      // object, so invalidating with it would miss the query above.
      queryClient.invalidateQueries({ queryKey: mcpOauthTokenQueryKeys.lists() })
    },
  })
}

/**
 * Admin users, so an authorization can name the person it acts as rather than
 * showing a bare `usr_…`.
 */
export const useAdminUserLookup = () => {
  const { data, ...rest } = useQuery({
    queryKey: [MCP_OAUTH_TOKENS_QUERY_KEY, "users"],
    queryFn: async () =>
      sdk.client.fetch<{ users: AdminUserSummary[] }>("/admin/users?limit=200", {
        method: "GET",
      }),
  })

  const byId: Record<string, AdminUserSummary> = {}
  for (const u of data?.users || []) byId[u.id] = u

  return { ...rest, usersById: byId }
}
