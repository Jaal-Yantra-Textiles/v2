/**
 * Pure read-model for OAuth authorizations (#1306 Track B).
 *
 * Split from the query hooks deliberately: those import the Medusa JS SDK,
 * which is built for Vite and uses `import.meta`, so anything importing them is
 * unloadable under Jest. Keeping the judgement calls here means the parts that
 * can actually be wrong are the parts that can be tested.
 */

export type McpOauthLevel = "read" | "write" | "sensitive" | "dangerous"

export type AdminMcpOauthToken = {
  id: string
  client_id: string
  client_name: string | null
  /** The admin this authorization acts as. */
  user_id: string
  level: McpOauthLevel
  revoked_at: string | null
  last_used_at: string | null
  access_expires_at: string | null
  refresh_expires_at: string | null
  created_at: string
}

export type AdminUserSummary = {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
}

export type TokenState = "revoked" | "expired" | "refreshable" | "active"

/**
 * An authorization is not simply on or off.
 *
 * A client whose ACCESS token has expired is not locked out — it still holds a
 * refresh token and will mint a new one without asking anyone. Reporting that
 * as "expired" would invite an admin to leave a live authorization in place
 * believing it had lapsed on its own, which is the one misreading here that
 * actually costs something.
 *
 * A missing expiry means "does not expire", never "expired" — failing the safe
 * way round would hide a live authorization behind a dead-looking label.
 */
export const tokenState = (
  t: AdminMcpOauthToken,
  now: number = Date.now()
): TokenState => {
  if (t.revoked_at) return "revoked"

  const refreshExpired =
    !!t.refresh_expires_at && new Date(t.refresh_expires_at).getTime() <= now
  if (refreshExpired) return "expired"

  const accessExpired =
    !!t.access_expires_at && new Date(t.access_expires_at).getTime() <= now
  return accessExpired ? "refreshable" : "active"
}

/**
 * Name the person an authorization acts as. "Acts as whom" is the whole
 * security question, and a bare `usr_…` does not answer it — but falling back
 * to the id beats rendering nothing when the lookup has not loaded.
 */
export const describeUser = (
  user: AdminUserSummary | undefined,
  userId: string
): string => {
  if (!user) return userId
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
  return name ? `${name} (${user.email})` : user.email
}
