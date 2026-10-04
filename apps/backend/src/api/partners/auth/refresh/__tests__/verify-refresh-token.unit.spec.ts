import jwt from "jsonwebtoken"

import {
  PARTNER_REFRESH_GRACE_DAYS,
  bearerFrom,
  verifyPartnerRefreshToken,
} from "../verify-refresh-token"

const SECRET = "unit-secret"
const DAY = 86400
const NOW = 1_800_000_000

const sign = (claims: Record<string, any>, secret = SECRET) => jwt.sign(claims, secret)
const partnerClaims = (exp: number) => ({
  actor_id: "partner_1",
  actor_type: "partner",
  auth_identity_id: "authid_1",
  auth_provider: "emailpass",
  app_metadata: { partner_id: "partner_1" },
  iat: exp - DAY,
  exp,
})

describe("verifyPartnerRefreshToken", () => {
  const cfg = { secret: SECRET, verifyOptions: { expiresIn: "1d" }, nowSec: NOW }

  it("accepts a still-valid partner token", () => {
    const r = verifyPartnerRefreshToken(sign(partnerClaims(NOW + 3600)), cfg)
    expect(r.ok).toBe(true)
  })

  it("accepts a token that expired 2 days ago", () => {
    const r = verifyPartnerRefreshToken(sign(partnerClaims(NOW - 2 * DAY)), cfg)
    expect(r.ok).toBe(true)
  })

  it("accepts exactly at the grace boundary, refuses one second past it", () => {
    const edge = NOW - PARTNER_REFRESH_GRACE_DAYS * DAY
    expect(verifyPartnerRefreshToken(sign(partnerClaims(edge)), cfg).ok).toBe(true)
    expect(verifyPartnerRefreshToken(sign(partnerClaims(edge - 1)), cfg).ok).toBe(false)
  })

  it("refuses a token that expired 40 days ago", () => {
    const r = verifyPartnerRefreshToken(sign(partnerClaims(NOW - 40 * DAY)), cfg)
    expect(r).toEqual({ ok: false, message: expect.stringContaining("log in again") })
  })

  it("refuses a token signed with another secret", () => {
    const r = verifyPartnerRefreshToken(sign(partnerClaims(NOW - DAY), "other"), cfg)
    expect(r).toEqual({ ok: false, message: "Invalid token" })
  })

  it("refuses a user (admin) token", () => {
    const r = verifyPartnerRefreshToken(
      sign({ ...partnerClaims(NOW - DAY), actor_type: "user", actor_id: "user_1" }),
      cfg
    )
    expect(r).toEqual({ ok: false, message: "Not a partner token" })
  })

  it("refuses an actorless partner token (registration, not yet a partner)", () => {
    const r = verifyPartnerRefreshToken(sign({ ...partnerClaims(NOW - DAY), actor_id: "" }), cfg)
    expect(r.ok).toBe(false)
  })

  it("refuses a token with no expiry", () => {
    const { exp, ...noExp } = partnerClaims(NOW)
    const r = verifyPartnerRefreshToken(sign(noExp), cfg)
    expect(r).toEqual({ ok: false, message: "Token has no expiry" })
  })

  it("refuses garbage and a missing token", () => {
    expect(verifyPartnerRefreshToken("garbage", cfg).ok).toBe(false)
    expect(verifyPartnerRefreshToken(null, cfg).ok).toBe(false)
  })

  it("accepts a wa-auth style token with no auth_provider", () => {
    const { auth_provider, ...wa } = partnerClaims(NOW - 2 * DAY)
    expect(verifyPartnerRefreshToken(sign(wa), cfg).ok).toBe(true)
  })
})

describe("bearerFrom", () => {
  it("extracts the token case-insensitively", () => {
    expect(bearerFrom("Bearer abc.def")).toBe("abc.def")
    expect(bearerFrom("bearer abc")).toBe("abc")
  })
  it("returns null for anything else", () => {
    expect(bearerFrom(undefined)).toBeNull()
    expect(bearerFrom("Basic abc")).toBeNull()
    expect(bearerFrom("Bearer")).toBeNull()
  })
})
