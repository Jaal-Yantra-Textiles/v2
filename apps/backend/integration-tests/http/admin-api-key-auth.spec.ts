import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

// PR #381: /admin/* routes get Medusa's default admin auth (session +
// bearer + api-key). Eleven matchers had re-registered authenticate()
// with only ["session","bearer"], silently breaking secret-key (sk_*)
// access. These tests pin api-key access on representatives of those
// routes so the narrowing can't sneak back in.
//
// NOTE: the shared suite truncates the DB around each test, so the
// api key MUST be created inside each test (a beforeAll key is wiped
// before later tests run — bearer JWTs survive because they don't
// need a DB row, which makes the failure mode extra confusing).
setupSharedTestSuite(() => {
  describe("admin routes accept secret-key auth", () => {
    const { api, getContainer } = getSharedTestEnv()

    async function setupKey() {
      await createAdminUser(getContainer())
      const adminHeaders = await getAuthHeaders(api)
      const keyRes = await api.post(
        "/admin/api-keys",
        { title: `auth-spec-${Date.now()}`, type: "secret" },
        adminHeaders
      )
      expect(keyRes.status).toBe(200)
      const token = keyRes.data.api_key.token
      expect(String(token)).toMatch(/^sk_/)
      // Secret keys authenticate as HTTP Basic with the key as username.
      const apiKeyHeaders = {
        headers: {
          Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
        },
      }
      return { adminHeaders, apiKeyHeaders }
    }

    it.each([
      ["/admin/designs/orders", [200]],
      // 404/4xx for the fake ids is fine — anything but 401 proves auth.
      ["/admin/orders/order_fake/design", [200, 404, 500]],
      ["/admin/customers/cus_fake/designs/ordered", [200, 404, 500]],
    ])("GET %s does not 401 with an sk_ key", async (path, okStatuses) => {
      const { apiKeyHeaders } = await setupKey()
      const res = await api.get(path, {
        ...apiKeyHeaders,
        validateStatus: () => true,
      })
      expect(res.status).not.toBe(401)
      expect(okStatuses).toContain(res.status)
    })

    it("still rejects unauthenticated requests", async () => {
      const res = await api.get("/admin/designs/orders", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(401)
    })

    it("still accepts bearer auth", async () => {
      const { adminHeaders } = await setupKey()
      const res = await api.get("/admin/designs/orders", {
        ...adminHeaders,
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
    })
  })
})
