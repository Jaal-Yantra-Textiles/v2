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

jest.setTimeout(180 * 1000)

/**
 * #1946 — the design-order page must read the ORDER, not the cart.
 *
 * The page is keyed on a CART line item and resolved its design through
 * `design_line_item`, the link that dies at checkout and is deliberately never
 * rewritten. Edit Items re-points the ORDER-level link (#1919). After a change
 * the two genuinely disagree, and Items — plus Production, which builds its
 * `designById` out of the same two fields — went on showing the design the
 * customer is no longer getting.
 *
 * 🔴 Only an integration test can show this. `defineLink(...).entryPoint` is
 * empty until the runtime loads links, so a unit test's link query goes out as
 * `entity: ""`, reads nothing, and passes while proving nothing.
 *
 * Everything runs in ONE `it`: the shared runner resets the customer
 * publishable-key session and cart data between `it` blocks, so all store-side
 * fixtures must be built and consumed within a single test.
 */
setupSharedTestSuite(() => {
  describe("#1946 — GET /admin/designs/orders/:cartLineItemId after a re-point", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let regionId: string
    let customerId: string

    const { api, getContainer } = getSharedTestEnv()

    const makeDesign = async (name: string): Promise<string> => {
      const res = await api.post(
        "/admin/designs",
        {
          name,
          description: "design-order detail re-point spec",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    const getDetail = async (cartLineItemId: string) => {
      const res = await api.get(
        `/admin/designs/orders/${cartLineItemId}`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      return res.data.design_order
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
          name: "Repoint Detail Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      await setupCheckoutInfrastructure(container, regionId)
      const { customer } = await createTestCustomer(container)
      customerId = customer.id
      customerHeaders = await getCustomerAuthHeaders()
    })

    it("shows what the ORDER says each line is now — primary, sibling, and detached", async () => {
      const container = getContainer()
      const stamp = Date.now()

      // Two commissioned designs, and two the customer will be moved to.
      const designA = await makeDesign(`Repoint A ${stamp}`)
      const designB = await makeDesign(`Repoint B ${stamp}`)
      const designC = await makeDesign(`Repoint C ${stamp}`)
      const designD = await makeDesign(`Repoint D ${stamp}`)

      /**
       * The store checkout route refuses a design the authenticated customer
       * does not own, so both designs are linked to the SUITE's customer —
       * the one `customerHeaders` actually authenticates as.
       */
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      for (const design_id of [designA, designB]) {
        await remoteLink
          .create({
            [DESIGN_MODULE]: { design_id },
            [Modules.CUSTOMER]: { customer_id: customerId },
          })
          .catch(() => {})
      }

      // ── One cart, two design line items ───────────────────────────────
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id

      const checkoutInto = async (designId: string): Promise<string> => {
        const res = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        )
        expect(res.status).toBe(200)
        expect(res.data.line_item_id).toBeDefined()
        return res.data.line_item_id as string
      }

      const cartLineA = await checkoutInto(designA)
      const cartLineB = await checkoutInto(designB)
      expect(cartLineA).not.toBe(cartLineB)

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

      // ── Convert to a real order ───────────────────────────────────────
      const convert = await api.post(
        `/admin/designs/orders/${cartLineA}/convert`,
        { payment_mode: "prepaid" },
        adminHeaders
      )
      expect(convert.status).toBe(200)
      const orderId = convert.data.design_order_conversion.order_id as string

      // The ORDER line item behind each cart line, via the bridge the
      // conversion stamps. Read independently of the route under test.
      const orderRes = await api.get(`/admin/orders/${orderId}`, adminHeaders)
      expect(orderRes.status).toBe(200)
      const orderLineFor = (cartLineItemId: string): string => {
        const item = (orderRes.data.order.items || []).find(
          (i: any) => i?.metadata?.source_cart_line_item_id === cartLineItemId
        )
        expect(item).toBeDefined()
        return item.id as string
      }
      const orderLineA = orderLineFor(cartLineA)
      const orderLineB = orderLineFor(cartLineB)

      // ── Before any change: what was commissioned IS what is being made ──
      const before = await getDetail(cartLineA)
      expect(before.design.id).toBe(designA)
      expect(before.design_binding.commissioned_design_id).toBe(designA)
      expect(before.design_binding.changed).toBe(false)
      expect(before.design_binding.detached).toBe(false)
      expect(before.design_binding.order_line_item_id).toBe(orderLineA)
      expect(before.sibling_items).toHaveLength(1)
      expect(before.sibling_items[0].design.id).toBe(designB)

      // ── Re-point the PRIMARY line: A → C ──────────────────────────────
      const repointA = await api.post(
        `/admin/designs/orders/${orderLineA}/design`,
        { design_id: designC, notify: false },
        adminHeaders
      )
      expect(repointA.status).toBe(200)
      expect(repointA.data.action).toBe("replaced")

      const afterPrimary = await getDetail(cartLineA)
      // 🔴 The assertion the old route failed: it answered `designA` here,
      // straight off the cart link, while Edit Items showed designC.
      expect(afterPrimary.design.id).toBe(designC)
      expect(afterPrimary.design.name).toContain("Repoint C")
      expect(afterPrimary.design_binding.changed).toBe(true)
      expect(afterPrimary.design_binding.detached).toBe(false)
      // The commission is still recorded — that is what the cart link is for.
      expect(afterPrimary.design_binding.commissioned_design_id).toBe(designA)

      // The order-items view agrees with the header.
      const primaryRow = afterPrimary.order_items.items.find(
        (r: any) => r.id === orderLineA
      )
      expect(primaryRow.design.id).toBe(designC)
      expect(primaryRow.original_design_id).toBe(designA)
      // #1946 — the Items section prices itself from the ORDER now.
      expect(primaryRow.unit_price).toEqual(expect.any(Number))

      // ── Re-point the SIBLING line: B → D ──────────────────────────────
      // Production builds `designById` out of `design` + `sibling_items[].design`,
      // so a stale sibling is a stale run card.
      const repointB = await api.post(
        `/admin/designs/orders/${orderLineB}/design`,
        { design_id: designD, notify: false },
        adminHeaders
      )
      expect(repointB.status).toBe(200)

      const afterSibling = await getDetail(cartLineA)
      expect(afterSibling.sibling_items).toHaveLength(1)
      expect(afterSibling.sibling_items[0].design.id).toBe(designD)
      expect(afterSibling.sibling_items[0].commissioned_design_id).toBe(designB)
      expect(afterSibling.sibling_items[0].detached).toBe(false)

      // ── Detach the primary line ───────────────────────────────────────
      const detach = await api.post(
        `/admin/designs/orders/${orderLineA}/design`,
        { design_id: null, notify: false },
        adminHeaders
      )
      expect(detach.status).toBe(200)

      const afterDetach = await getDetail(cartLineA)
      expect(afterDetach.design_binding.detached).toBe(true)
      // Reported as detached rather than silently shown as still being made:
      // the page keeps its subject (the commissioned design) and says so.
      expect(afterDetach.design_binding.commissioned_design_id).toBe(designA)
      const detachedRow = afterDetach.order_items.items.find(
        (r: any) => r.id === orderLineA
      )
      expect(detachedRow.design).toBeNull()
    })
  })
})
