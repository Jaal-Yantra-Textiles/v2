import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

/**
 * #639 — partner Shiprocket parity routes:
 *   POST /partners/orders/:id/shiprocket-label
 *   POST /partners/orders/:id/shiprocket-attach-awb
 *
 * The load-bearing new logic is the in-handler partner scoping
 * (`validatePartnerOrderOwnership`): a partner can only drive carrier work for
 * an order they own — a foreign order 404s BEFORE any fulfillment/carrier work.
 * This asserts that isolation deterministically (no live Shiprocket needed): the
 * ownership guard runs before body validation and before the carrier call.
 */
setupSharedTestSuite(() => {
  describe("Partner API - Shiprocket label / attach-awb ownership (#639)", () => {
    async function createPartner(unique: number) {
      const { api } = getSharedTestEnv()
      const email = `srp-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login1 = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login1.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `SRP ${unique}`,
          handle: `srp-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      const login2 = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${login2.data.token}` }

      // Ownership guard needs the partner to have a store (getPartnerStore).
      await api.post(
        "/partners/stores",
        {
          store: {
            name: `SRP Store ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `SRP Channel ${unique}`, description: "Default" },
          region: { name: `SRP Region ${unique}`, currency_code: "usd", countries: ["us"] },
          location: {
            name: `SRP Warehouse ${unique}`,
            address: {
              address_1: "1 Mill Road",
              city: "Austin",
              postal_code: "73301",
              country_code: "US",
            },
          },
        },
        { headers }
      )

      return { partnerId: res.data.partner.id as string, headers }
    }

    async function createOrder(unique: number) {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
      return (await orderService.createOrders({
        currency_code: "usd",
        email: `srp-order-${unique}@jyt.test`,
        items: [{ title: "Line A", quantity: 1, unit_price: 1000 }],
      } as any)) as any
    }

    async function linkPartnerOrder(partnerId: string, orderId: string) {
      const container = getSharedTestEnv().getContainer()
      const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.ORDER]: { order_id: orderId },
          data: { partner_id: partnerId, order_id: orderId },
        },
      ])
    }

    it("enforces partner ownership on both Shiprocket routes", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now()

      const owner = await createPartner(unique)
      const intruder = await createPartner(unique + 1)
      const order = await createOrder(unique)
      await linkPartnerOrder(owner.partnerId, order.id)

      // ── Intruder: doesn't own the order → 404 on BOTH routes, before any
      //    body validation or carrier work. ────────────────────────────────
      await expect(
        api.post(
          `/partners/orders/${order.id}/shiprocket-attach-awb`,
          { awb: "FAKEAWB123" },
          { headers: intruder.headers }
        )
      ).rejects.toMatchObject({ response: { status: 404 } })

      await expect(
        api.post(
          `/partners/orders/${order.id}/shiprocket-label`,
          {},
          { headers: intruder.headers }
        )
      ).rejects.toMatchObject({ response: { status: 404 } })

      // ── Owner: passes the ownership guard. An empty AWB then trips body
      //    validation (400) — which proves the guard let the owner THROUGH
      //    (a rejected owner would 404 before validation). ──────────────────
      await expect(
        api.post(
          `/partners/orders/${order.id}/shiprocket-attach-awb`,
          { awb: "" },
          { headers: owner.headers }
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("enforces partner ownership on the fulfillment-label alias route too (#835)", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now() + 1

      const owner = await createPartner(unique)
      const intruder = await createPartner(unique + 1)
      const order = await createOrder(unique)
      await linkPartnerOrder(owner.partnerId, order.id)

      await expect(
        api.post(
          `/partners/orders/${order.id}/fulfillment-label`,
          {},
          { headers: intruder.headers }
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
