import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

/**
 * The arrival chain, end to end (#2111).
 *
 * 🔴 THIS SUITE EXISTS BECAUSE THE UNIT TESTS CANNOT DO ITS JOB.
 * `defineLink().entryPoint` is EMPTY under jest — the framework derives it at
 * boot and nothing boots in a unit test — so every unit test of this feature
 * stubs the link table by hand and proves only that the resolver reads whatever
 * it is handed. Medusa also ABBREVIATES a long link table name, and a wrong one
 * comes back EMPTY rather than erroring. Only a booted runtime can tell a
 * working link from a silently mistyped one.
 *
 * So the first assertion below is a CONTROL: if `entryPoint` is empty, every
 * later assertion in this file could pass while reading nothing at all.
 */
jest.setTimeout(120 * 1000)

const testDesign = {
  name: "Arrival Test Design",
  description: "Design waiting on cloth",
  design_type: "Original",
  status: "Conceptual",
  priority: "Medium",
  tags: ["arrival-test"],
}

/** The subscriber runs off the event bus, so the stamp lands a beat later. */
const waitFor = async <T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  tries = 25
): Promise<T> => {
  let last = await read()
  for (let i = 0; i < tries && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 200))
    last = await read()
  }
  return last
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("design → material arrival", () => {
    let headers: any
    let designId: string
    let customerId: string
    let inventoryOrderId: string
    let designInventoryOrderLink: any

    const readLinkRows = async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data } = await query.graph({
        entity: designInventoryOrderLink.entryPoint,
        filters: { design_id: designId },
        fields: [
          "design_id",
          "inventory_orders_id",
          "notify_customer",
          "notified_at",
          "note",
        ],
      })
      return (data || []) as any[]
    }

    beforeAll(async () => {
      /*
       * Imported lazily. A top-level import of a `defineLink` file throws at
       * module evaluation in this harness, and a suite that fails to LOAD
       * reports ZERO tests — which reads exactly like a suite that passed.
       */
      /*
       * A VARIABLE specifier, not a literal. TypeScript's node16 resolution
       * demands a `.js` extension on a literal relative import; jest's resolver
       * refuses that same extension. A variable path satisfies both — and the
       * import stays lazy, which is the part that matters.
       */
      const linkModule = "../../src/links/design-inventory-order"
      designInventoryOrderLink = (await import(linkModule)).default
    })

    beforeEach(async () => {
      try {
      const container = getContainer()

      /*
       * 🔴 The template has to exist. `sendDesignStatusUpdateEmailWorkflow`
       * fetches it from the database and throws when it is missing, and the
       * subscriber stamps `notified_at` only AFTER the send — so without this
       * row the arrival is never marked as announced. That is the correct
       * behaviour (do not record a mail that did not go), and it is exactly why
       * the seed script ships alongside the feature.
       */
      const { EMAIL_TEMPLATES_MODULE } = await import(
        "../../src/modules/email_templates" as string
      )
      const { designMaterialsDeliveredEmailTemplates } = await import(
        "../../src/scripts/seed-design-materials-delivered-email" as string
      )
      const templates: any = container.resolve(EMAIL_TEMPLATES_MODULE)
      const [existing] = await templates.listAndCountEmailTemplates({
        template_key: "design-materials-delivered",
      })
      if (!existing?.length) {
        await templates.createEmailTemplates(
          designMaterialsDeliveredEmailTemplates
        )
      }
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      const designRes = await api.post("/admin/designs", testDesign, headers)
      designId = designRes.data.design.id

      const customerRes = await api.post(
        "/admin/customers",
        {
          first_name: "Arrival",
          last_name: "Client",
          email: `arrival-${Date.now()}@test.com`,
        },
        headers
      )
      customerId = customerRes.data.customer.id

      /*
       * The order route requires a destination and an address: an inventory
       * order that says what is coming but not where it is going cannot be
       * received. Created here rather than shared, so each test gets its own.
       */
      const itemRes = await api.post(
        "/admin/inventory-items",
        { title: `Arrival Cloth ${Date.now()}` },
        headers
      )
      const inventoryItemId = itemRes.data.inventory_item.id

      const locRes = await api.post(
        "/admin/stock-locations",
        { name: `Arrival WH ${Date.now()}` },
        headers
      )
      const stockLocationId = locRes.data.stock_location.id

      const orderRes = await api.post(
        "/admin/inventory-orders",
        {
          // A real line, not a sample: the route refuses an empty order unless
          // it is explicitly a sample, and an arrival is about actual cloth.
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 86, price: 806.3 },
          ],
          quantity: 86,
          total_price: 69340,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            address_1: "1 Loom Lane",
            city: "Dharamshala",
            postal_code: "176215",
            country_code: "IN",
          },
          stock_location_id: stockLocationId,
          to_stock_location_id: stockLocationId,
        },
        headers
      )
      inventoryOrderId =
        orderRes.data.inventoryOrder?.id ?? orderRes.data.inventory_order?.id
      } catch (e: any) {
        console.error("SETUP FAILED", e?.config?.url, JSON.stringify(e?.response?.data))
        throw e
      }
    })

    it("🔴 CONTROL: the link resolves to a real table", () => {
      // If this is empty, every other assertion here can pass over nothing.
      expect(designInventoryOrderLink.entryPoint).toBeTruthy()
      expect(typeof designInventoryOrderLink.entryPoint).toBe("string")
    })

    describe("whose design it is", () => {
      it("attaches a customer to a bare design — no order, no cart", async () => {
        /*
         * The whole point of the design-scoped route: until it existed a design
         * could only acquire a customer by being SOLD, because the other route
         * needs a design-order line item to work from.
         */
        const res = await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: customerId },
          headers
        )

        expect(res.status).toBe(200)
        expect(res.data.design_customer).toMatchObject({
          design_id: designId,
          customer_id: customerId,
          changed: true,
        })

        const detail = await api.get(
          `/admin/designs/${designId}?fields=*,customers.*`,
          headers
        )
        const linked = (detail.data.design.customers || []).filter(Boolean)
        expect(linked.map((c: any) => c.id)).toContain(customerId)
      })

      it("🔴 keeps ONE commissioner — a second attach replaces, never appends", async () => {
        /*
         * `design ↔ customer` answers "whose design is this", not "who has
         * bought it". Two rows would make the answer depend on which surface
         * read it first — the email workflow takes `take: 1`.
         */
        const second = await api.post(
          "/admin/customers",
          {
            first_name: "Second",
            last_name: "Client",
            email: `arrival-2-${Date.now()}@test.com`,
          },
          headers
        )

        await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: customerId },
          headers
        )
        await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: second.data.customer.id },
          headers
        )

        const detail = await api.get(
          `/admin/designs/${designId}?fields=*,customers.*`,
          headers
        )
        const linked = (detail.data.design.customers || []).filter(Boolean)
        expect(linked).toHaveLength(1)
        expect(linked[0].id).toBe(second.data.customer.id)
      })

      it("detaches on null, leaving the design reachable by nobody", async () => {
        await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: customerId },
          headers
        )
        const res = await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: null },
          headers
        )

        expect(res.status).toBe(200)
        const detail = await api.get(
          `/admin/designs/${designId}?fields=*,customers.*`,
          headers
        )
        expect((detail.data.design.customers || []).filter(Boolean)).toHaveLength(0)
      })

      it("refuses a customer id that does not resolve", async () => {
        // A link row pointing at nobody reads as "linked" on every screen and
        // reaches no one — the exact failure this route exists to fix.
        await expect(
          api.post(
            `/admin/designs/${designId}/customer`,
            { customer_id: "cus_does_not_exist" },
            headers
          )
        ).rejects.toMatchObject({ response: { status: 404 } })
      })
    })

    describe("what the design is waiting for", () => {
      it("attaches an inventory order and reads it back with its switch", async () => {
        const res = await api.post(
          `/admin/designs/${designId}/inventory-orders`,
          { inventory_order_id: inventoryOrderId, note: "the GOF cloth" },
          headers
        )

        expect(res.status).toBe(200)
        // 🔴 Attaching sends nothing NOW — it arms a future status change.
        expect(res.data.design_inventory_order.notified).toBe(false)

        const list = await api.get(
          `/admin/designs/${designId}/inventory-orders`,
          headers
        )
        expect(list.data.design_inventory_orders).toHaveLength(1)
        expect(list.data.design_inventory_orders[0]).toMatchObject({
          id: inventoryOrderId,
          status: "Pending",
          notify_customer: true,
          note: "the GOF cloth",
        })
      })

      it("🔴 carries notify_customer: false through the round trip", async () => {
        /*
         * This is the switch that decides whether a client is written to. A
         * default that swallowed it would send mail to someone who asked not to
         * be told, and the row would look untouched.
         */
        await api.post(
          `/admin/designs/${designId}/inventory-orders`,
          { inventory_order_id: inventoryOrderId, notify_customer: false },
          headers
        )

        const rows = await readLinkRows()
        expect(rows).toHaveLength(1)
        expect(rows[0].notify_customer).toBe(false)
      })
    })

    describe("the arrival itself", () => {
      const deliver = async () => {
        const workflowModule =
          "../../src/workflows/inventory_orders/update-inventory-order"
        const { updateInventoryOrderWorkflow } = await import(workflowModule)
        return updateInventoryOrderWorkflow(getContainer()).run({
          input: { id: inventoryOrderId, update: { status: "Delivered" } },
          throwOnError: false,
        })
      }

      it("🔴 stamps notified_at when the cloth lands", async () => {
        await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: customerId },
          headers
        )
        await api.post(
          `/admin/designs/${designId}/inventory-orders`,
          { inventory_order_id: inventoryOrderId },
          headers
        )

        await deliver()

        const rows = await waitFor(readLinkRows, (r) => !!r[0]?.notified_at)
        expect(rows[0].notified_at).toBeTruthy()
        /*
         * 🔴 And the switch SURVIVED the stamp. Extra columns on a link are
         * changed by dismiss + create, so a stamp carrying only `notified_at`
         * would write a row whose `notify_customer` is gone — silently
         * reverting a client who asked not to be told.
         */
        expect(rows[0].notify_customer).toBe(true)
      })

      /**
       * 🔴 READ THIS TEST TOGETHER WITH THE ONE ABOVE, NEVER ALONE.
       *
       * It is a negative assertion, so a subscriber that never ran at all would
       * pass it. Proven by mutation: neutralising the subscriber entirely turns
       * "stamps notified_at" red and leaves THIS one green. The positive test is
       * what proves the machinery runs; this one proves it obeys the switch.
       * Deleting either leaves the other able to pass over nothing.
       */
      it("🔴 does NOT stamp a suppressed attachment", async () => {
        await api.post(
          `/admin/designs/${designId}/customer`,
          { customer_id: customerId },
          headers
        )
        await api.post(
          `/admin/designs/${designId}/inventory-orders`,
          { inventory_order_id: inventoryOrderId, notify_customer: false },
          headers
        )

        await deliver()

        // Given a beat to be wrong in, and still not stamped.
        await new Promise((r) => setTimeout(r, 1500))
        const rows = await readLinkRows()
        expect(rows[0].notified_at).toBeFalsy()
      })

      it("says nothing when no order is attached, and does not throw", async () => {
        // The delivery is a fact already recorded; failing here must not make
        // it look otherwise.
        const result = await deliver()
        expect(result.errors?.length ?? 0).toBe(0)
        expect(await readLinkRows()).toHaveLength(0)
      })
    })
  })
})
