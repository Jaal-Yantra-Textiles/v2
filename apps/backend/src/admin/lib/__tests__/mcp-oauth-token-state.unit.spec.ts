import {
  describeUser,
  tokenState,
  type AdminMcpOauthToken,
} from "../mcp-oauth-token-state"

const NOW = new Date("2026-08-17T12:00:00Z").getTime()
const past = "2026-08-17T11:00:00Z"
const future = "2026-08-17T13:00:00Z"

const token = (over: Partial<AdminMcpOauthToken> = {}): AdminMcpOauthToken => ({
  id: "mcpt_1",
  client_id: "mcpc_1",
  client_name: "Claude",
  user_id: "usr_1",
  level: "read",
  revoked_at: null,
  last_used_at: null,
  access_expires_at: future,
  refresh_expires_at: future,
  created_at: past,
  ...over,
})

describe("tokenState", () => {
  it("is active while both tokens are in date", () => {
    expect(tokenState(token(), NOW)).toBe("active")
  })

  /**
   * The distinction the whole screen hangs on: a lapsed ACCESS token is not a
   * lapsed authorization. The client still holds a refresh token and will mint
   * a new access token without anyone approving it again — so reporting this as
   * "expired" would invite an admin to leave a live authorization in place.
   */
  it("reports a lapsed access token as refreshable, not expired", () => {
    expect(
      tokenState(
        token({ access_expires_at: past, refresh_expires_at: future }),
        NOW
      )
    ).toBe("refreshable")
  })

  it("is expired only once the refresh token has lapsed too", () => {
    expect(
      tokenState(
        token({ access_expires_at: past, refresh_expires_at: past }),
        NOW
      )
    ).toBe("expired")
  })

  it("reports revoked ahead of every expiry state", () => {
    expect(
      tokenState(
        token({
          revoked_at: past,
          access_expires_at: past,
          refresh_expires_at: past,
        }),
        NOW
      )
    ).toBe("revoked")
  })

  it("treats a missing expiry as not expired rather than as expired", () => {
    expect(
      tokenState(
        token({ access_expires_at: null, refresh_expires_at: null }),
        NOW
      )
    ).toBe("active")
  })
})

describe("describeUser", () => {
  it("falls back to the raw id when the user cannot be resolved", () => {
    expect(describeUser(undefined, "usr_9")).toBe("usr_9")
  })

  it("prefers a name, and keeps the email alongside it", () => {
    expect(
      describeUser(
        { id: "usr_1", email: "a@b.com", first_name: "Ada", last_name: "L" },
        "usr_1"
      )
    ).toBe("Ada L (a@b.com)")
  })

  it("uses the email alone when there is no name", () => {
    expect(
      describeUser(
        { id: "usr_1", email: "a@b.com", first_name: null, last_name: null },
        "usr_1"
      )
    ).toBe("a@b.com")
  })
})
