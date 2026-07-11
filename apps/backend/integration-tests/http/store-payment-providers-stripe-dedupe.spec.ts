import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * #985 — GET /store/payment-providers override that collapses the two Stripe
 * providers into a single buyer-facing "Stripe", chosen by the region's owning
 * partner's Connect status.
 *
 * The pure selection (connected → Connect, else standard; incl. the
 * India-partner-in-EU-region case) is locked in
 * `dedupe-stripe-providers.unit.spec.ts`, and the region→partner resolution in
 * the same lib. Registering the real Stripe providers needs a live-key boot the
 * shared test app doesn't do, so here we assert the HTTP override itself: it is
 * wired, mirrors core for a region's linked providers, and the no-owning-partner
 * path (connected=false) resolves cleanly without dropping non-Stripe providers.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /store/payment-providers — Stripe dedupe override", () => {
    let pk: string
    let regionId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      const region = await api.post(
        "/admin/regions",
        { name: "US", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )
      regionId = region.data.region.id
      await setupCheckoutInfrastructure(container, regionId)
    })

    const storeHeaders = () => ({ headers: { "x-publishable-api-key": pk } })

    it("returns the region's linked providers (core parity, no-partner region)", async () => {
      const res = await api.get(
        `/store/payment-providers?region_id=${regionId}`,
        storeHeaders()
      )
      expect(res.status).toBe(200)
      const ids = res.data.payment_providers.map((p: any) => p.id)
      // pp_system_default is linked by setupCheckoutInfrastructure; a region
      // with no owning partner resolves connected=false and drops nothing here.
      expect(ids).toContain("pp_system_default")
      expect(res.data.count).toBe(res.data.payment_providers.length)
    })

    it("never surfaces a stripe-connect entry for a non-partner region", async () => {
      const res = await api.get(
        `/store/payment-providers?region_id=${regionId}`,
        storeHeaders()
      )
      const ids = res.data.payment_providers.map((p: any) => p.id)
      expect(ids).not.toContain("pp_stripe-connect_stripe-connect")
    })
  })
})
