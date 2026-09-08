/**
 * What a sign-in response on the MCP authorize page actually means.
 *
 * ## The trap this exists to remove
 *
 * `POST /auth/user/emailpass` answers an MFA-enabled account with
 *
 *   { mfa_required: true, mfa_challenge: {...}, token: "<ACTORLESS jwt>" }
 *
 * — HTTP 200, and it CARRIES A TOKEN. The page's original guard was
 * `if (!login.ok || !body.token) throw`, which both of those pass, so the flow
 * continued to `/oauth/authorize/consent` with a token that has no `actor_id`.
 * Consent runs `authenticate("user")` and reads `auth.actor_id`, so it answered
 * 401 and the page showed "Could not authorize." Nothing anywhere said "second
 * factor". The token being present is exactly why the bug was invisible.
 *
 * The actorless token is not useless — it is the credential that authorizes
 * `POST /auth/mfa/challenges/:id/verify`, and nothing else.
 *
 * ## Why this lives in its own module
 *
 * The authorize page is a self-contained HTML string with inline browser JS, so
 * there is nothing for a test to import. Rather than keep a tested copy here and
 * an untested copy in the template — two homes for one rule — the page embeds
 * this function verbatim via `Function.prototype.toString()`. The function the
 * tests exercise IS the function the browser runs.
 *
 * 🔴 It must therefore stay SELF-CONTAINED: no imports, no module-scope
 * constants, no TS-only runtime constructs. A closure reference would compile
 * fine here and throw `ReferenceError` in the browser.
 */

export type MfaChallengeLike = {
  id: string
  methods?: string[]
}

export type LoginOutcome =
  /** First factor passed; a second is required before the token means anything. */
  | { kind: "mfa"; challenge: MfaChallengeLike; token: string }
  /** Fully authenticated: this token carries an actor and is good for consent. */
  | { kind: "token"; token: string }
  | { kind: "error"; message: string }

export function loginOutcome(ok: boolean, body: any): LoginOutcome {
  var b = body || {}
  if (!ok) {
    return { kind: "error", message: b.message || "Sign-in failed." }
  }
  // Checked BEFORE the token, because an MFA response has one.
  if (b.mfa_required) {
    if (b.mfa_challenge && b.mfa_challenge.id && b.token) {
      return { kind: "mfa", challenge: b.mfa_challenge, token: b.token }
    }
    return {
      kind: "error",
      message:
        "This account requires a second factor, but the server did not return a usable challenge.",
    }
  }
  if (b.verification_required) {
    return {
      kind: "error",
      message:
        "This account needs to be verified before it can authorize a client.",
    }
  }
  if (!b.token) {
    return { kind: "error", message: b.message || "Sign-in failed." }
  }
  return { kind: "token", token: b.token }
}
