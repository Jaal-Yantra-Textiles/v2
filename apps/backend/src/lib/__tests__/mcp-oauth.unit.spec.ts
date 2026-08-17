/**
 * The OAuth front door's pure half (#1306 Track B).
 *
 * These assert the properties that make the flow safe rather than the ones that
 * make it work — a working flow is what the integration path proves. Here:
 * PKCE actually binds the code, redirect matching is exact, an OAuth token is
 * distinguishable from the admin JWT it is shaped like, and the discovery
 * documents point somewhere a client can reach.
 */
import crypto from "crypto"
import jwt from "jsonwebtoken"
import {
  MCP_OAUTH_RESOURCE_PATH,
  authorizationServerMetadata,
  bearerChallenge,
  isAcceptableRedirectUri,
  levelFromScopeString,
  mcpOauthTokenIdFromRequest,
  mintAccessToken,
  protectedResourceMetadata,
  redirectUriRegistered,
  verifyPkce,
} from "../mcp-oauth"
import { mcpPrincipalFromRequest } from "../mcp-scope"

const challengeFor = (verifier: string) =>
  crypto.createHash("sha256").update(verifier).digest("base64url")

// 43 chars is the RFC 7636 minimum; anything shorter is not a verifier.
const VERIFIER = "a".repeat(43)

describe("PKCE", () => {
  it("accepts the verifier that produced the challenge", () => {
    expect(verifyPkce(challengeFor(VERIFIER), "S256", VERIFIER)).toBe(true)
  })

  it("rejects any other verifier", () => {
    expect(verifyPkce(challengeFor(VERIFIER), "S256", "b".repeat(43))).toBe(
      false
    )
  })

  it("rejects a verifier outside the RFC length bounds", () => {
    // Short verifiers are brute-forceable, which defeats the entire point of
    // binding the code to the client.
    expect(verifyPkce(challengeFor("short"), "S256", "short")).toBe(false)
    expect(verifyPkce(challengeFor("x".repeat(129)), "S256", "x".repeat(129))).toBe(
      false
    )
  })

  it("does not treat the challenge itself as a valid verifier", () => {
    const challenge = challengeFor(VERIFIER)
    expect(verifyPkce(challenge, "S256", challenge)).toBe(false)
  })
})

describe("redirect URI handling", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback"]

  it("matches only verbatim", () => {
    expect(redirectUriRegistered(registered, registered[0])).toBe(true)
  })

  it("rejects a prefix, a suffix, and an added query", () => {
    // Loose matching here is the classic open-redirect hole: it turns an
    // authorization server into a token-exfiltration service.
    expect(redirectUriRegistered(registered, "https://claude.ai")).toBe(false)
    expect(
      redirectUriRegistered(registered, registered[0] + ".evil.com")
    ).toBe(false)
    expect(redirectUriRegistered(registered, registered[0] + "?x=1")).toBe(
      false
    )
  })

  it("rejects an empty candidate against an empty registration", () => {
    expect(redirectUriRegistered([], "")).toBe(false)
    expect(redirectUriRegistered(undefined, "https://claude.ai")).toBe(false)
  })

  it("accepts https, loopback http, and private-use schemes at registration", () => {
    expect(isAcceptableRedirectUri("https://claude.ai/cb")).toBe(true)
    expect(isAcceptableRedirectUri("http://127.0.0.1:51763/cb")).toBe(true)
    expect(isAcceptableRedirectUri("http://localhost:8080/cb")).toBe(true)
    expect(isAcceptableRedirectUri("com.example.app:/oauth")).toBe(true)
  })

  it("rejects plaintext http off-loopback, fragments, and nonsense", () => {
    expect(isAcceptableRedirectUri("http://evil.com/cb")).toBe(false)
    expect(isAcceptableRedirectUri("https://claude.ai/cb#frag")).toBe(false)
    expect(isAcceptableRedirectUri("not a url")).toBe(false)
  })
})

describe("scope strings", () => {
  it("takes the widest recognized rung", () => {
    expect(levelFromScopeString("mcp:read mcp:write")).toBe("write")
    expect(levelFromScopeString("mcp:dangerous")).toBe("dangerous")
  })

  it("ignores unknown entries rather than failing the request", () => {
    // Clients routinely send openid/offline_access; refusing the whole request
    // over one would break a connection we can serve. The admin picks the
    // actual rung at consent, so a generous parse grants nothing.
    expect(levelFromScopeString("openid offline_access mcp:read")).toBe("read")
    expect(levelFromScopeString("openid")).toBeNull()
    expect(levelFromScopeString(undefined)).toBeNull()
  })
})

describe("the access token", () => {
  const SECRET = "test-secret"

  it("is a Medusa user JWT — the framework rejects any other actor type", () => {
    const token = mintAccessToken({
      secret: SECRET,
      userId: "usr_123",
      authIdentityId: "authid_1",
      tokenId: "mcpt_abc",
    })
    const payload = jwt.verify(token, SECRET) as any
    expect(payload.actor_type).toBe("user")
    expect(payload.actor_id).toBe("usr_123")
    expect(payload.auth_identity_id).toBe("authid_1")
    expect(payload.mcp_oauth).toEqual({ token_id: "mcpt_abc" })
  })

  it("honours its own expiry rather than the global jwtExpiresIn", () => {
    const token = mintAccessToken({
      secret: SECRET,
      userId: "usr_123",
      tokenId: "mcpt_abc",
      expiresInSec: 60,
    })
    const payload = jwt.verify(token, SECRET) as any
    expect(payload.exp - payload.iat).toBe(60)
  })

  it("resolves to an `oauth` principal keyed on the TOKEN, not the user", () => {
    // This is the whole Track B integration: scope binds to the token, so two
    // clients authorized by the same admin can hold different levels.
    const req = {
      auth_context: {
        actor_id: "usr_123",
        actor_type: "user",
        mcp_oauth: { token_id: "mcpt_abc" },
      },
    } as any
    expect(mcpOauthTokenIdFromRequest(req)).toBe("mcpt_abc")
    expect(mcpPrincipalFromRequest(req)).toEqual({
      type: "oauth",
      id: "mcpt_abc",
    })
  })

  it("leaves an ordinary admin JWT resolving as a user", () => {
    const req = {
      auth_context: { actor_id: "usr_123", actor_type: "user" },
    } as any
    expect(mcpPrincipalFromRequest(req)).toEqual({
      type: "user",
      id: "usr_123",
    })
  })

  it("ignores a malformed mcp_oauth claim instead of trusting it", () => {
    const req = {
      auth_context: {
        actor_id: "usr_123",
        actor_type: "user",
        mcp_oauth: { token_id: 42 },
      },
    } as any
    expect(mcpOauthTokenIdFromRequest(req)).toBeNull()
    expect(mcpPrincipalFromRequest(req)).toEqual({
      type: "user",
      id: "usr_123",
    })
  })
})

describe("discovery", () => {
  const ISSUER = "https://api.example.com"

  it("points the client at the mount that can actually challenge it", () => {
    // Not /admin/mcp: the framework's 401 there cannot carry a
    // WWW-Authenticate header, which is what makes discovery work at all.
    const doc = protectedResourceMetadata(ISSUER)
    expect(doc.resource).toBe(`${ISSUER}${MCP_OAUTH_RESOURCE_PATH}`)
    expect(doc.resource).not.toContain("/admin/")
    expect(doc.authorization_servers).toEqual([ISSUER])
  })

  it("advertises S256 only", () => {
    // `plain` offers no protection against a code intercepted on the redirect
    // leg — the single thing PKCE exists to stop.
    const doc = authorizationServerMetadata(ISSUER)
    expect(doc.code_challenge_methods_supported).toEqual(["S256"])
    expect(doc.grant_types_supported).not.toContain("client_credentials")
  })

  it("names the protected-resource document in the challenge", () => {
    const header = bearerChallenge(ISSUER, {
      code: "invalid_token",
      description: "nope",
    })
    expect(header).toContain(
      `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`
    )
    expect(header).toContain(`error="invalid_token"`)
  })
})
