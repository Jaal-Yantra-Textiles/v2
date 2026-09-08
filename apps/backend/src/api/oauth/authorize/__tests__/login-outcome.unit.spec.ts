import { loginOutcome } from "../login-outcome"

/**
 * The bug these pin: an MFA sign-in response is HTTP 200 AND carries a token,
 * so the page's original `if (!ok || !body.token) throw` accepted it as a
 * completed sign-in and sent an ACTORLESS token to /oauth/authorize/consent.
 * Consent runs authenticate("user"), so it 401'd — and the screen said
 * "Could not authorize", never "enter your second factor".
 */
describe("loginOutcome (MCP authorize page)", () => {
  const challenge = { id: "authmfachal_1", methods: ["totp"] }

  it("treats an MFA response as a CHALLENGE even though it carries a token", () => {
    const out = loginOutcome(true, {
      mfa_required: true,
      mfa_challenge: challenge,
      token: "actorless.jwt",
    })
    expect(out.kind).toBe("mfa")
    // The actorless token is the credential for the verify call — not for consent.
    expect(out).toEqual({ kind: "mfa", challenge, token: "actorless.jwt" })
  })

  it("does NOT report the MFA response as a completed sign-in", () => {
    // The precise regression: `kind: "token"` here is what sent the actorless
    // token to consent.
    const out = loginOutcome(true, {
      mfa_required: true,
      mfa_challenge: challenge,
      token: "actorless.jwt",
    })
    expect(out.kind).not.toBe("token")
  })

  it("passes a normal sign-in straight through", () => {
    expect(loginOutcome(true, { token: "real.jwt" })).toEqual({
      kind: "token",
      token: "real.jwt",
    })
  })

  it("carries the server's message on a failed sign-in", () => {
    expect(loginOutcome(false, { message: "Invalid email or password" })).toEqual({
      kind: "error",
      message: "Invalid email or password",
    })
  })

  it("falls back to a generic message when the server sends none", () => {
    expect(loginOutcome(false, {})).toEqual({
      kind: "error",
      message: "Sign-in failed.",
    })
  })

  it("errors rather than proceeding when MFA is demanded without a usable challenge", () => {
    // Would otherwise strand the page on a code prompt it cannot submit.
    const out = loginOutcome(true, { mfa_required: true, token: "actorless.jwt" })
    expect(out.kind).toBe("error")
    const noId = loginOutcome(true, {
      mfa_required: true,
      mfa_challenge: {},
      token: "actorless.jwt",
    })
    expect(noId.kind).toBe("error")
    const noToken = loginOutcome(true, {
      mfa_required: true,
      mfa_challenge: challenge,
    })
    expect(noToken.kind).toBe("error")
  })

  it("reports verification_required distinctly from a plain failure", () => {
    const out = loginOutcome(true, {
      verification_required: true,
      token: "actorless.jwt",
    })
    expect(out.kind).toBe("error")
    expect((out as any).message).toMatch(/verified/i)
  })

  it("treats a 200 with no token as a failure", () => {
    expect(loginOutcome(true, {}).kind).toBe("error")
  })

  it("tolerates a null/absent body", () => {
    expect(loginOutcome(true, null).kind).toBe("error")
    expect(loginOutcome(false, undefined).kind).toBe("error")
  })

  /**
   * The page embeds this function with `toString()`. A closure reference would
   * compile here and throw ReferenceError in the browser, so the emitted source
   * must not mention anything from module scope.
   */
  it("is self-contained, so it survives being embedded in the page", () => {
    const src = loginOutcome.toString()
    expect(src).toMatch(/^function loginOutcome\s*\(/)
    expect(src).not.toMatch(/\brequire\b|\bimport\b|exports\./)
  })

  /**
   * The page is a TEMPLATE LITERAL, so a backtick or a ${...} anywhere in this
   * function's source would terminate or interpolate the string. That is not
   * hypothetical: two backticks in a comment inside the page's own script broke
   * route registration outright ("Expected ',', got 'token'").
   */
  it("contains nothing that would break the template literal it is embedded in", () => {
    const src = loginOutcome.toString()
    expect(src).not.toContain("`")
    expect(src).not.toContain("${")
  })
})
