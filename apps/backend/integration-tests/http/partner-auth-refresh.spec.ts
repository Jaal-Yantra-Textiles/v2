/**
 * POST /partners/auth/refresh — exchange a partner JWT, even an expired one
 * (up to 30 days past expiry), for a fresh one.
 *
 * The expired cases matter most: they prove the route is NOT behind
 * `authenticate("partner", …)`, which would 401 an expired token before the
 * handler ever ran.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

const PASSWORD = "supersecret"
const DAY = 86400
const REFRESH = "/partners/auth/refresh"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /partners/auth/refresh", () => {
    let partnerId: string
    let partnerToken: string
    let secret: string
    let unique: number

    const call = (token: string | null) =>
      api
        .post(REFRESH, {}, token === null ? {} : { headers: { Authorization: `Bearer ${token}` } })
        .catch((e: any) => e.response)

    /** The same claims, re-signed so that `exp` is `daysAgo` days in the past. */
    const expiredCopy = (token: string, daysAgo: number, drop: string[] = []) => {
      const { exp, iat, ...claims } = jwt.decode(token) as any
      for (const k of drop) delete claims[k]
      const now = Math.floor(Date.now() / 1000)
      return jwt.sign({ ...claims, iat: now - (daysAgo + 1) * DAY, exp: now - daysAgo * DAY }, secret)
    }

    beforeEach(async () => {
      unique = Date.now()
      const container = getContainer()
      secret = (container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any).projectConfig.http.jwtSecret

      const email = `refresh-${unique}@jyt.test`
      await api.post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const l1 = await api.post("/auth/partner/emailpass", { email, password: PASSWORD })
      const p = await api.post(
        "/partners",
        { name: `Refresh ${unique}`, handle: `refresh-${unique}`, admin: { email, first_name: "R", last_name: "F" } },
        { headers: { Authorization: `Bearer ${l1.data.token}` } }
      )
      partnerId = p.data.partner.id
      const l2 = await api.post("/auth/partner/emailpass", { email, password: PASSWORD })
      partnerToken = l2.data.token
    })

    const expectFreshPartnerToken = async (token: string) => {
      const claims = jwt.verify(token, secret) as any
      expect(claims.actor_type).toBe("partner")
      expect(claims.actor_id).toBe(partnerId)
      expect(claims.auth_provider).toBe("emailpass")
      const now = Math.floor(Date.now() / 1000)
      // http.jwtExpiresIn default: 1d
      expect(claims.exp - now).toBeGreaterThan(DAY - 120)
      expect(claims.exp - now).toBeLessThanOrEqual(DAY + 5)
      // …and the framework accepts it on an authenticated partner route.
      const me = await api.get("/partners/details", { headers: { Authorization: `Bearer ${token}` } })
      expect(me.status).toBe(200)
    }

    it("valid token → new token", async () => {
      const res = await call(partnerToken)
      expect(res.status).toBe(200)
      expect(Object.keys(res.data)).toEqual(["token"])
      await expectFreshPartnerToken(res.data.token)
    })

    it("token expired 2 days ago → new token (reaches the handler past authenticate)", async () => {
      const expired = expiredCopy(partnerToken, 2)
      // Sanity: the framework itself rejects this token.
      const denied = await api
        .get("/partners/details", { headers: { Authorization: `Bearer ${expired}` } })
        .catch((e: any) => e.response)
      expect(denied.status).toBe(401)

      const res = await call(expired)
      expect(res.status).toBe(200)
      await expectFreshPartnerToken(res.data.token)
    })

    it("a wa-auth style token (no auth_provider) expired 2 days ago → new token", async () => {
      const wa = expiredCopy(partnerToken, 2, ["auth_provider", "user_metadata", "mfa_enabled", "mfa_challenge_completed_at"])
      expect((jwt.decode(wa) as any).auth_provider).toBeUndefined()
      const res = await call(wa)
      expect(res.status).toBe(200)
      await expectFreshPartnerToken(res.data.token)
    })

    it("token expired 40 days ago → 401", async () => {
      const res = await call(expiredCopy(partnerToken, 40))
      expect(res.status).toBe(401)
      expect(typeof res.data.message).toBe("string")
    })

    it("an admin (user) token → 401", async () => {
      await createAdminUser(getContainer())
      const adminHeaders = await getAuthHeaders(api)
      const adminToken = adminHeaders.headers.Authorization.replace(/^Bearer /, "")
      const res = await call(adminToken)
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("Not a partner token")
    })

    it("garbage → 401; no header → 401", async () => {
      const res = await call("garbage")
      expect(res.status).toBe(401)
      expect(typeof res.data.message).toBe("string")
      const none = await call(null)
      expect(none.status).toBe(401)
    })

    it("a deleted auth identity → 401", async () => {
      const { auth_identity_id } = jwt.decode(partnerToken) as any
      const authModule: any = getContainer().resolve("auth")
      await authModule.deleteAuthIdentities([auth_identity_id])
      const res = await call(partnerToken)
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("Auth identity not found")
    })

    it("an inactive partner admin → 401", async () => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "partners", fields: ["admins.id"], filters: { id: partnerId } })
      const svc: any = getContainer().resolve(PARTNER_MODULE)
      await svc.updatePartnerAdmins({ id: data[0].admins[0].id, is_active: false })
      const res = await call(expiredCopy(partnerToken, 2))
      expect(res.status).toBe(401)
      expect(res.data.message).toBe("Partner admin is inactive")
    })
  })
})
