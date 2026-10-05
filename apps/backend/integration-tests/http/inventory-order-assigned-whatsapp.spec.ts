import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import {
  notifyPartnerOfInventoryOrder,
  orderAssignedContextId,
} from "../../src/workflows/inventory_orders/lib/notify-partner-of-order"

jest.setTimeout(120 * 1000)

/**
 * Sending an inventory order to a partner tells them on WhatsApp, item by item.
 *
 * Before this, `inventory_order_assigned_to_partner` was emitted and nothing
 * turned it into a message — partners learned of an order only from the portal.
 * Outside Meta's 24 h window the text rides the approved prose carrier
 * `jyt_partner_message_v1` (flattened: no newlines in a template parameter);
 * inside it, it goes as plain text with one item per line.
 */
setupSharedTestSuite(() => {
  describe("send-to-partner → item-wise WhatsApp to the partner", () => {
    const { api, getContainer } = getSharedTestEnv()
    let sent: Array<{ type: string; to: string; args: any[] }> = []
    let restore: () => void = () => {}

    beforeEach(() => {
      const whatsapp = (getContainer().resolve(SOCIAL_PROVIDER_MODULE) as any).getWhatsApp(getContainer())
      const originals = {
        sendTextMessage: whatsapp.sendTextMessage.bind(whatsapp),
        sendTemplateMessage: whatsapp.sendTemplateMessage.bind(whatsapp),
      }
      const record = (type: string) => async (to: string, ...args: any[]) => {
        sent.push({ type, to, args })
        return { messages: [{ id: `wamid.mock_${Date.now()}_${sent.length}` }] }
      }
      whatsapp.sendTextMessage = record("text")
      whatsapp.sendTemplateMessage = record("template")
      restore = () => Object.assign(whatsapp, originals)
      sent = []
    })

    afterEach(() => restore())

    const waitForRow = async (messaging: any, orderId: string) => {
      for (let i = 0; i < 30; i++) {
        const [rows] = await messaging.listAndCountMessagingMessages(
          { context_type: "inventory_order", context_id: orderAssignedContextId(orderId) },
          { take: 5 }
        )
        if (rows?.length) return rows
        await new Promise((r) => setTimeout(r, 200))
      }
      return []
    }

    it("messages the partner on send, falls back to the template outside the window, and never on assign", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const unique = Date.now()

      // send-to-partner refuses without these task templates (prod has them).
      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await api.post(
          "/admin/task-templates",
          {
            name,
            description: `${name} template`,
            priority: "medium",
            estimated_duration: 30,
            eventable: true,
            notifiable: true,
            metadata: { workflow_type: "partner_assignment" },
          },
          { ...adminHeaders, validateStatus: () => true }
        )
      }

      const email = `inv-wa-${unique}@jyt.test`
      const ok = { validateStatus: () => true }
      const reg = await api.post("/auth/partner/emailpass/register", { email, password: "supersecret" }, ok)
      expect([reg.status, reg.data?.message]).toEqual([200, undefined])
      const login = await api.post("/auth/partner/emailpass", { email, password: "supersecret" }, ok)
      expect([login.status, login.data?.message]).toEqual([200, undefined])
      const partnerRes = await api.post(
        "/partners",
        {
          name: `Kala Weaver ${unique}`,
          handle: `kala-weaver-${unique}`,
          admin: { email, first_name: "Haresh", last_name: "Test" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` }, ...ok }
      )
      expect([partnerRes.status, partnerRes.data?.message]).toEqual([200, undefined])
      const partnerId = partnerRes.data.partner.id

      const phone = `9190${String(unique).slice(-8)}`
      const messaging: any = container.resolve(MESSAGING_MODULE)
      const conversation = await messaging.createMessagingConversations({
        partner_id: partnerId,
        phone_number: phone,
        title: "Haresh",
        metadata: { language: "hi" },
      })

      const item = await api.post(
        "/admin/inventory-items",
        { title: "Red Dyed Kala Cotton" },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect([item.status, item.data?.message]).toEqual([200, undefined])
      // The admin route does not take unit_of_measure; set it the way the
      // raw-material form does, on the item itself.
      await (container.resolve("inventory") as any).updateInventoryItems({
        id: item.data.inventory_item.id,
        unit_of_measure: "Meter",
      } as any)
      const location = await api.post(
        "/admin/stock-locations",
        { name: `WA Test ${unique}` },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect([location.status, location.data?.message]).toEqual([200, undefined])
      const newOrder = async () => {
        const res = await api.post(
          "/admin/inventory-orders",
          {
            order_lines: [{ inventory_item_id: item.data.inventory_item.id, quantity: 10, price: 300 }],
            quantity: 10,
            total_price: 3000,
            status: "Pending",
            expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {},
            stock_location_id: location.data.stock_location.id,
            is_sample: false,
          },
          { ...adminHeaders, validateStatus: () => true }
        )
        expect([res.status, res.data?.message]).toEqual([201, undefined])
        return res.data.inventoryOrder.id as string
      }

      // ── 1. No inbound in 24 h → the approved prose template, flattened ──
      const orderA = await newOrder()
      const sendA = await api.post(
        `/admin/inventory-orders/${orderA}/send-to-partner`,
        { partnerId, notes: "Please send photos." },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect([sendA.status, sendA.status === 200 ? null : sendA.data]).toEqual([200, null])
      const rowsA = await waitForRow(messaging, orderA)
      expect(rowsA).toHaveLength(1)
      expect(rowsA[0].message_type).toBe("template")
      const tmpl = sent.find((s) => s.type === "template")
      expect(tmpl?.to).toBe(phone)
      expect(tmpl?.args[0]).toBe("jyt_partner_message_v1")
      expect(tmpl?.args[1]).toBe("hi")
      const param: string = tmpl?.args[2][0].parameters[0].text
      expect(param).toContain("Namaste Haresh ji")
      expect(param).toContain("1. Red Dyed Kala Cotton — 10 m @ ₹300/m")
      expect(param).toContain("Kul: 10 m, ₹3,000")
      expect(param).toContain("Note: Please send photos.")
      expect(param).not.toMatch(/\n/)

      // Once per order: a second notify for the same order sends nothing.
      const again = await notifyPartnerOfInventoryOrder(container as any, {
        inventory_order_id: orderA,
        partner_id: partnerId,
      })
      expect(again).toEqual({ sent: false, reason: "already_notified" })

      // ── 2. Partner wrote today → plain text, one item per line ──────────
      await messaging.createMessagingMessages({
        conversation_id: conversation.id,
        direction: "inbound",
        content: "ok ji",
        message_type: "text",
        status: "delivered",
      })
      sent = []
      const orderB = await newOrder()
      const sendB = await api.post(
        `/admin/inventory-orders/${orderB}/send-to-partner`,
        { partnerId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect([sendB.status, sendB.status === 200 ? null : sendB.data]).toEqual([200, null])
      const rowsB = await waitForRow(messaging, orderB)
      expect(rowsB).toHaveLength(1)
      expect(rowsB[0].message_type).toBe("text")
      const text = sent.find((s) => s.type === "text")
      expect(text?.args[0]).toContain("\n1. Red Dyed Kala Cotton — 10 m @ ₹300/m\n")
      expect(text?.args[0]).toContain("item-wise dekh kar quantity confirm")

      // ── 3. assign-partner records offline work: it must tell nobody ─────
      sent = []
      const orderC = await newOrder()
      const assign = await api.post(
        `/admin/inventory-orders/${orderC}/assign-partner`,
        { partner_id: partnerId },
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(assign.status).toBe(200)
      await new Promise((r) => setTimeout(r, 1500))
      const [rowsC] = await messaging.listAndCountMessagingMessages(
        { context_type: "inventory_order", context_id: orderAssignedContextId(orderC) },
        { take: 5 }
      )
      expect(rowsC).toHaveLength(0)
      expect(sent).toHaveLength(0)
    })
  })
})
