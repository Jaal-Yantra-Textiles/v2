/**
 * #780 H7c — two concurrent sends of one inventory order to the SAME partner.
 *
 * The route's pre-check is a read-then-act: both requests read "no partner
 * tasks yet" and both proceed. Before the fix, both then created a full set of
 * partner tasks, messaged the partner twice, and left two long-running workflow
 * instances parked in `awaitOrderStart`.
 *
 * ⚠️ The cross-partner case is NOT what this covers — `Link.create` already
 * refuses a second partner for one order (singular-side uniqueness, cf. #1775).
 * The hole was the same partner twice, where the duplicate link is a silent
 * no-op. Verified by probe before this test was written.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const TEST_PARTNER_EMAIL = "partner@concurrent-claim-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

const PARTNER_TASK_TITLES = [
  "partner-order-sent",
  "partner-order-received",
  "partner-order-shipped",
]

setupSharedTestSuite(() => {
  describe("Send to Partner — concurrent claim (#780 H7c)", () => {
    let appContainer
    let partnerId
    let inventoryOrderId
    let adminHeaders
    const { api, getContainer } = getSharedTestEnv()

    beforeEach(async () => {
      appContainer = getContainer()

      await createAdminUser(appContainer)
      adminHeaders = await getAuthHeaders(api)

      await api.post("/auth/partner/emailpass/register", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      const login = await api.post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      let partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

      const partnerResponse = await api.post(
        "/partners",
        {
          name: "Concurrent Claim Partner",
          handle: "concurrent-claim-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Partner",
            last_name: "Admin",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = partnerResponse.data.partner.id

      // The workflow creates its partner tasks from templates; without these
      // the send 400s before it ever reaches the claim (cost one red run).
      for (const [name, step] of [
        ["partner-order-sent", "sent"],
        ["partner-order-received", "received"],
        ["partner-order-shipped", "shipped"],
      ]) {
        const templateResponse = await api.post(
          "/admin/task-templates",
          {
            name,
            description: `Template for ${name}`,
            priority: "medium",
            estimated_duration: 30,
            required_fields: {
              order_id: { type: "string", required: true },
              partner_id: { type: "string", required: true },
            },
            eventable: true,
            notifiable: true,
            message_template: `Order {{order_id}} — ${name}.`,
            metadata: { workflow_type: "partner_assignment", workflow_step: step },
          },
          adminHeaders
        )
        expect(templateResponse.status).toBe(201)
      }

      const inventoryResponse = await api.post(
        "/admin/inventory-items",
        { title: "Concurrent Claim Fabric", description: "fabric" },
        adminHeaders
      )
      const inventoryItemId = inventoryResponse.data.inventory_item.id

      const stockLocationResponse = await api.post(
        "/admin/stock-locations",
        { name: "Concurrent Claim Warehouse" },
        adminHeaders
      )
      const stockLocationId = stockLocationResponse.data.stock_location.id

      const orderResponse = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 10, price: 20 },
          ],
          quantity: 10,
          total_price: 200,
          status: "Pending",
          expected_delivery_date: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            address_1: "1 Race St",
            city: "Race City",
            postal_code: "12345",
            country_code: "US",
          },
          stock_location_id: stockLocationId,
          is_sample: false,
        },
        adminHeaders
      )
      expect(orderResponse.status).toBe(201)
      inventoryOrderId = orderResponse.data.inventoryOrder.id
    })

    const partnerTaskTitles = async (): Promise<string[]> => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "tasks.*"],
        filters: { id: inventoryOrderId },
      })
      const tasks: any[] = (data?.[0] as any)?.tasks ?? []
      return tasks
        .map((t) => t?.title)
        .filter((title) => PARTNER_TASK_TITLES.includes(title))
    }

    it("claims the assignment exactly once when two identical sends race", async () => {
      const send = () =>
        api
          .post(
            `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
            { partnerId, notes: "racing" },
            adminHeaders
          )
          .catch((err) => err.response)

      // Fired together so both clear the route's read-then-act pre-check.
      const [first, second] = await Promise.all([send(), send()])

      const statuses = [first?.status, second?.status].sort()
      // Exactly one winner. The loser is refused — 409 from the pre-check if it
      // happened to read late, otherwise the claim step's CONFLICT.
      expect(statuses.filter((s) => s === 200)).toHaveLength(1)
      expect(statuses.filter((s) => s !== 200)).toHaveLength(1)

      // The assertion that actually matters: the mutation, not the status code.
      // A duplicated send is only visible as duplicated tasks.
      const titles = await partnerTaskTitles()
      expect(titles.sort()).toEqual([...PARTNER_TASK_TITLES].sort())
    })

    it("records the winning transaction id as the claim", async () => {
      const response = await api.post(
        `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
        { partnerId, notes: "single send" },
        adminHeaders
      )
      expect(response.status).toBe(200)

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "partner_assignment_id"],
        filters: { id: inventoryOrderId },
      })
      expect((data?.[0] as any)?.partner_assignment_id).toEqual(
        expect.any(String)
      )
    })
  })
})
