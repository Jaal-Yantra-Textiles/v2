import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Copy,
  Heading,
  Skeleton,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { ShieldCheck } from "@medusajs/icons"

import {
  useAdminUserLookup,
  useMcpOauthTokens,
  useRevokeMcpOauthToken,
} from "../../../hooks/api/mcp-oauth-tokens"
import {
  describeUser,
  tokenState,
  type AdminMcpOauthToken,
  type TokenState,
} from "../../../lib/mcp-oauth-token-state"

/**
 * Settings → MCP OAuth Authorizations (#1306 Track B).
 *
 * The API to list and revoke these landed with the front door; this is the
 * screen for it. Without one, revoking a client meant knowing an `mcpt_…` id
 * nobody had ever been shown.
 *
 * Two facts drive the whole layout, because both are easy to get wrong and
 * expensive to get wrong:
 *
 * 1. An authorization is a **user JWT** — it acts AS an admin, and everything
 *    it does is attributed to that person. So the person is displayed as
 *    prominently as the client, by name rather than by `usr_…`.
 * 2. An expired ACCESS token is not a lapsed authorization — the client still
 *    holds a refresh token and will quietly mint a new one. That state is
 *    labelled "access expired · will refresh" rather than "expired", so nobody
 *    leaves a live authorization in place believing it died of old age.
 */

const STATE_LABEL: Record<TokenState, string> = {
  active: "Active",
  refreshable: "Access expired · will refresh",
  expired: "Expired",
  revoked: "Revoked",
}

const STATE_COLOR: Record<TokenState, "green" | "orange" | "grey" | "red"> = {
  active: "green",
  refreshable: "orange",
  expired: "grey",
  revoked: "red",
}

const levelColor = (level: string) =>
  level === "read"
    ? "grey"
    : level === "write"
      ? "blue"
      : level === "sensitive"
        ? "orange"
        : "red"

const formatWhen = (value: string | null): string => {
  if (!value) return "never"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString()
}

const McpOauthTokensPage = () => {
  const prompt = usePrompt()
  const { tokens, isLoading } = useMcpOauthTokens()
  const { usersById } = useAdminUserLookup()
  const revoke = useRevokeMcpOauthToken()

  // The dashboard is served by the backend, so its origin IS the resource
  // server an MCP client should be pointed at.
  const mountUrl =
    typeof window !== "undefined" ? `${window.location.origin}/mcp/admin` : "/mcp/admin"

  // "Live" means still able to reach the API — so a `refreshable` one counts
  // (it mints a new access token on its own) but an `expired` one does not.
  const live = (tokens || []).filter((t) => {
    const s = tokenState(t)
    return s === "active" || s === "refreshable"
  })

  const onRevoke = async (t: AdminMcpOauthToken) => {
    const who = describeUser(usersById[t.user_id], t.user_id)
    const ok = await prompt({
      title: `Revoke ${t.client_name || t.client_id}?`,
      description:
        `This takes effect on the client's very next request, reads included. ` +
        `${who} will have to authorize it again from scratch to restore access. ` +
        `The client is not told — it will simply start receiving 401s. Continue?`,
      confirmText: "Revoke",
      cancelText: "Cancel",
    })
    if (!ok) return

    try {
      await revoke.mutateAsync(t.id)
      toast.success(`Revoked ${t.client_name || t.client_id}`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to revoke")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div>
          <Heading>MCP OAuth Authorizations</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            External clients — Claude, ChatGPT, Cursor — that an admin has
            authorized to act on their behalf over MCP. Each one is revocable
            here, and takes effect immediately.
          </Text>
        </div>
        {!isLoading && (
          <Badge size="2xsmall" color={live.length ? "green" : "grey"}>
            {live.length} live
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2 px-6 py-4">
        <Text size="small" weight="plus">
          Connect a client
        </Text>
        <div className="flex items-center gap-2">
          <Text size="small" className="font-mono text-ui-fg-subtle">
            {mountUrl}
          </Text>
          <Copy content={mountUrl} />
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          Give a client this URL — it discovers the authorization server on its
          own and sends the admin here to sign in and consent. Nothing needs to
          be created in advance; the authorization appears below once granted.
        </Text>
      </div>

      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          <span className="text-ui-fg-base">How much can these do?</span> An
          authorization is a signed-in admin session scoped to a level, not a
          lesser kind of credential — on any route the per-tier guard does not
          cover it is as capable as the dashboard. Narrow one further under{" "}
          <span className="text-ui-fg-base">MCP Access Scopes</span>, which keys
          on the authorization id shown below.
        </Text>
      </div>

      <div className="px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !tokens?.length ? (
          <Text size="small" className="text-ui-fg-subtle">
            No client has been authorized yet. Point one at the URL above to
            create the first authorization.
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {tokens.map((t) => {
              const state = tokenState(t)
              const who = describeUser(usersById[t.user_id], t.user_id)

              return (
                <div
                  key={t.id}
                  data-testid={`mcp-oauth-token-row-${t.id}`}
                  className="flex items-start justify-between gap-4 rounded-lg border border-ui-border-base px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text size="small" weight="plus">
                        {t.client_name || t.client_id}
                      </Text>
                      <Badge size="2xsmall" color={STATE_COLOR[state]}>
                        {STATE_LABEL[state]}
                      </Badge>
                      <Badge size="2xsmall" color={levelColor(t.level)}>
                        {t.level}
                      </Badge>
                    </div>

                    {/* An OAuth token IS this person's session. Say so. */}
                    <Text size="small" className="text-ui-fg-subtle" leading="compact">
                      Acts as <span className="text-ui-fg-base">{who}</span>
                    </Text>

                    <Text
                      size="small"
                      className="truncate font-mono text-ui-fg-subtle"
                      leading="compact"
                    >
                      {t.id} · {t.client_id}
                    </Text>

                    <Text size="small" className="text-ui-fg-subtle" leading="compact">
                      Authorized {formatWhen(t.created_at)} · last used{" "}
                      {formatWhen(t.last_used_at)}
                      {t.revoked_at && ` · revoked ${formatWhen(t.revoked_at)}`}
                    </Text>

                    {/* Stated outright rather than hidden behind a hover: this
                        is the one state an admin is likely to misread as
                        "it has lapsed on its own, leave it". */}
                    {state === "refreshable" && (
                      <Text
                        size="small"
                        className="text-ui-fg-subtle"
                        leading="compact"
                      >
                        Its access token has lapsed, but its refresh token has
                        not — this client can mint a new one without anyone
                        approving it again.{" "}
                        <span className="text-ui-fg-base">
                          Revoke to actually stop it.
                        </span>
                      </Text>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {state === "revoked" ? (
                      <Text size="small" className="text-ui-fg-muted">
                        Revoked
                      </Text>
                    ) : (
                      <Button
                        size="small"
                        variant="danger"
                        disabled={revoke.isPending}
                        onClick={() => onRevoke(t)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}

export default McpOauthTokensPage

export const config = defineRouteConfig({
  label: "MCP OAuth Authorizations",
  icon: ShieldCheck,
})

export const handle = {
  breadcrumb: () => "MCP OAuth Authorizations",
}
