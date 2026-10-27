import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  getTestCustomerCredentials,
} from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"

jest.setTimeout(120 * 1000)

/**
 * #2463 — the customer approves or rejects the finished goods from a no-login
 * link. Answerable once; a newer request supersedes the old link; a rejection
 * needs a reason and alerts us; an approval on an order with a paid deposit
 * raises the balance and hands back the pay link.
 *
 * Everything runs in ONE `it`: the shared test runner resets the customer
 * publishable-key session AND cart data between `it` blocks, so all store-side
 * fixtures must be built and consumed within a single test (same constraint as
 * design-to-order-e2e.spec.ts).
 */
setupSharedTestSuite(() => {
  describe("customer finished-goods approval (#2463)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    // Build a fresh design order (cart → design line item → address); returns
    // its line_item_id. Uses the suite's single customer/key session.
    const buildDesignOrder = async (): Promise<{ lineItemId: string; cartId: string }> => {
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id

      const checkoutRes = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartId, currency_code: "usd" },
        customerHeaders
      )
      expect(checkoutRes.status).toBe(200)
      const lineItemId = checkoutRes.data.line_item_id
      expect(lineItemId).toBeDefined()

      const credentials = getTestCustomerCredentials()
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: credentials.email,
          shipping_address: {
            first_name: "Test",
            last_name: "Customer",
            address_1: "123 Main St",
            city: "New York",
            postal_code: "10001",
            country_code: "us",
          },
        },
        customerHeaders
      )
      return { lineItemId, cartId }
    }

    beforeAll(async () => {
      const container = getContainer()

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Approval Test Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Approval Design ${Date.now()}`,
          description: "approval test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      designId = designRes.data.design.id
      await setupCheckoutInfrastructure(container, regionId)

      // #2328 — the region must charge tax, or a capture of the PRE-tax total
      // is indistinguishable from the right one. 5% like Indian GST on textiles.
      const tax: any = container.resolve(Modules.TAX)
      const existingTax = await tax.listTaxRegions({ country_code: "us" })
      if (!existingTax.length) {
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "us",
              provider_id: "tp_system",
              default_tax_rate: { name: "Test GST", code: "TEST-GST", rate: 5 },
            } as any,
          ],
        })
      }

      const { customer } = await createTestCustomer(container)
      customerHeaders = await getCustomerAuthHeaders()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink
        .create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: customer.id },
        })
        .catch(() => {})
    })

    it("sends, supersedes, rejects with a reason, and raises the balance on approval", async () => {
      process.env.BACKEND_URL = process.env.BACKEND_URL || "http://localhost:9000"
      process.env.ROOT_DOMAIN = process.env.ROOT_DOMAIN || "shop.test"
      const container = getContainer()

      const placeOrder = async () => {
        const { lineItemId, cartId } = await buildDesignOrder()
        const conv = await api.post(
          `/admin/designs/orders/${lineItemId}/convert`,
          { payment_mode: "cod" },
          adminHeaders
        )
        return { orderId: conv.data.design_order_conversion.order_id as string, cartId }
      }
      const request = (orderId: string, body: Record<string, unknown>) =>
        api
          .post(`/admin/orders/${orderId}/approval-requests`, body, adminHeaders)
          .catch((e: any) => e.response)
      const view = (token: string) =>
        api.get(`/store/order-approvals/${token}`, customerHeaders).catch((e: any) => e.response)
      const decide = (token: string, body: Record<string, unknown>) =>
        api
          .post(`/store/order-approvals/${token}/decision`, body, customerHeaders)
          .catch((e: any) => e.response)
      const tokenOf = (url: string) => url.split("/approvals/")[1]

      expect((await view("not-a-real-token")).status).toBe(404)

      // ── An order with no photos anywhere is refused, not sent empty ───────
      const one = await placeOrder()
      const empty = await request(one.orderId, {})
      expect(empty.status).toBe(400)

      // ── Send, then the customer page ──────────────────────────────────────
      const first = await request(one.orderId, {
        photo_urls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
        note: "Your 10 aprons are done.",
      })
      expect(first.status).toBe(200)
      expect(first.data.order_approval.approval_url).toContain("/approvals/")
      const oldToken = tokenOf(first.data.order_approval.approval_url)

      const page = (await view(oldToken)).data.order_approval
      expect(page.status).toBe("pending")
      expect(page.answerable).toBe(true)
      expect(page.photos.map((p: any) => p.url)).toEqual([
        "https://cdn.test/a.jpg",
        "https://cdn.test/b.jpg",
      ])
      expect(page.note).toBe("Your 10 aprons are done.")
      expect(page.order_display_id).toEqual(expect.any(Number))
      expect(page).not.toHaveProperty("token_hash")

      // ── A newer request supersedes the old link ───────────────────────────
      const second = await request(one.orderId, { photo_urls: ["https://cdn.test/c.jpg"] })
      expect(second.data.order_approval.superseded).toEqual([first.data.order_approval.id])
      const token = tokenOf(second.data.order_approval.approval_url)
      const stale = (await view(oldToken)).data.order_approval
      expect(stale.status).toBe("superseded")
      expect(stale.answerable).toBe(false)
      expect((await decide(oldToken, { decision: "approved" })).status).toBe(409)

      // ── Reject: a reason is required, and it is answerable once ───────────
      expect((await decide(token, { decision: "rejected", reason: "  " })).status).toBe(400)
      expect((await decide(token, { decision: "maybe" })).status).toBe(400)
      const rejected = await decide(token, { decision: "rejected", reason: "Logo is crooked" })
      expect(rejected.status).toBe(200)
      expect(rejected.data.order_approval.status).toBe("rejected")
      expect(rejected.data.order_approval.decision_reason).toBe("Logo is crooked")
      expect(rejected.data.order_approval.balance_pay_url).toBeNull()
      expect((await decide(token, { decision: "approved" })).status).toBe(409)

      // We were alerted.
      const feed = await container
        .resolve(Modules.NOTIFICATION)
        .listNotifications({ channel: "feed" }, { take: 200 })
      const alert = feed.find(
        (n: any) =>
          n.data?.metadata?.kind === "order_approval_decided" &&
          n.data?.metadata?.order_id === one.orderId
      )
      expect(alert?.data?.metadata?.decision).toBe("rejected")
      expect(alert?.data?.metadata?.reason).toBe("Logo is crooked")

      // The admin list shows both, newest first, without the hash.
      const list = await api.get(`/admin/orders/${one.orderId}/approval-requests`, adminHeaders)
      expect(list.data.order_approvals.map((a: any) => a.status)).toEqual([
        "rejected",
        "superseded",
      ])
      expect(list.data.order_approvals[0]).not.toHaveProperty("token_hash")

      // ── Approve on an order with a PAID deposit: the balance is raised ────
      const two = await placeOrder()
      // What the order still owes — the figure the balance step reconciles to.
      const total = Number(
        (await api.get(`/admin/orders/${two.orderId}?fields=id,summary`, adminHeaders)).data.order
          .summary.pending_difference
      )
      expect(total).toBeGreaterThan(0)
      const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
      const schedule = await schedules.openForCart({
        cart_id: two.cartId,
        currency_code: "usd",
        total_due: total,
        source_type: "manual",
        rail: "stripe",
        // The balance the schedule asks for must equal what the order still
        // owes, or the balance step refuses (correctly). A COD-converted order
        // owes its whole total, so the fixture's "paid deposit" is 0 and the
        // balance is the total. In real life the deposit was captured at
        // checkout and the two agree the same way.
        quote_deposit_pct: 0,
        balance_trigger: "manual",
      })
      await schedules.attachOrder(schedule.id, two.orderId)
      await schedules.markDepositPaid(schedule.id, "test")

      const req2 = await request(two.orderId, { photo_urls: ["https://cdn.test/d.jpg"] })
      const approved = await decide(tokenOf(req2.data.order_approval.approval_url), {
        decision: "approved",
      })
      expect(approved.status).toBe(200)
      expect(approved.data.order_approval.status).toBe("approved")
      // The alert carries what happened to the balance, in words.
      const feed2 = await container
        .resolve(Modules.NOTIFICATION)
        .listNotifications({ channel: "feed" }, { take: 200 })
      const alert2 = feed2.find((n: any) => n.data?.metadata?.order_id === two.orderId)
      expect(alert2?.data?.description).toContain("raised")
      expect(approved.data.order_approval.balance_pay_url).toEqual(expect.any(String))
      expect((await schedules.findByOrderId(two.orderId)).balance_status).toBe("due")
    })
  })
})
