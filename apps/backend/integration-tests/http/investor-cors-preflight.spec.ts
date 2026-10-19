/**
 * The investor app (invest.jaalyantra.com) calls /investors/* cross-origin.
 * A browser sends a preflight OPTIONS with no credentials first; if that
 * answers 401 without CORS headers, every investor data call is blocked even
 * though login itself works.
 */
// Byte-for-byte the prod value on 2026-10-19: SSM stored a trailing newline,
// so the last origin never matched and its preflight fell through to auth.
process.env.PARTNER_CORS = "https://partner.jaalyantra.com,https://invest.jaalyantra.com\n"

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

const INVEST_ORIGIN = "https://invest.jaalyantra.com"

setupSharedTestSuite(() => {
  const { api } = getSharedTestEnv()

  const preflight = (path: string, method: string) =>
    api
      .request({
        method: "OPTIONS",
        url: path,
        headers: {
          Origin: INVEST_ORIGIN,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "authorization,content-type",
        },
        validateStatus: () => true,
      })

  describe("investor CORS preflight", () => {
    it.each([
      ["/investors/me", "GET"],
      ["/investors/me", "POST"],
      ["/investors/cap-tables", "GET"],
      ["/investors/companies", "GET"],
    ])("lets the browser through for %s %s", async (path, method) => {
      const res = await preflight(path, method)

      expect(res.status).toBe(204)
      expect(res.headers["access-control-allow-origin"]).toBe(INVEST_ORIGIN)
      expect(res.headers["access-control-allow-credentials"]).toBe("true")
    })

    it("still refuses the real request without a login", async () => {
      const res = await api.get("/investors/cap-tables", {
        headers: { Origin: INVEST_ORIGIN },
        validateStatus: () => true,
      })

      expect(res.status).toBe(401)
      expect(res.headers["access-control-allow-origin"]).toBe(INVEST_ORIGIN)
    })
  })
})
