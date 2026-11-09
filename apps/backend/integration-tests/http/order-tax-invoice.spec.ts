import { Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { resolveBrandStore } from "../../src/workflows/consumption-logs/lib/apply-to-inventory"
import { financialYearOf } from "../../src/lib/invoices/order-tax-invoice-model"

jest.setTimeout(300 * 1000)

/**
 * #2532 — GST tax invoices for our own store's orders: preview spends no
 * number, issuing twice returns the same invoice, a changed order needs
 * reissue (old one cancelled, next number), a partner-store order is refused.
 */
setupSharedTestSuite(() => {
  describe("/admin/orders/:id/tax-invoices", () => {
    let adminHeaders: Record<string, any>
    let brandChannelId: string

    const container = () => getSharedTestEnv().getContainer()

    beforeAll(async () => {
      const { api } = getSharedTestEnv()
      await createAdminUser(container())
      adminHeaders = await getAuthHeaders(api)

      // Seller address = the brand store's default location (Dharamshala).
      const brand = await resolveBrandStore(container())
      brandChannelId = brand.default_sales_channel_id!
      const location = (
        await api.post(
          "/admin/stock-locations",
          {
            name: `Dharamshala ${Date.now()}`,
            address: {
              address_1: "Sidhbari",
              city: "Dharamshala",
              province: "Himachal Pradesh",
              postal_code: "176057",
              country_code: "in",
            },
          },
          adminHeaders
        )
      ).data.stock_location
      const storeService: any = container().resolve(Modules.STORE)
      await storeService.updateStores(brand.id, { default_location_id: location.id })
    })

    /** 2 × ₹1,000 + 5% GST, shipped to Karnataka. */
    const createOrder = async (salesChannelId: string) => {
      const orderService: any = container().resolve(Modules.ORDER)
      const order = await orderService.createOrders({
        sales_channel_id: salesChannelId,
        currency_code: "inr",
        email: `tax-invoice-${Date.now()}@jaalyantra.test`,
        status: "pending",
        shipping_address: {
          first_name: "Priya",
          last_name: "Sharma",
          address_1: "12 MG Road",
          city: "Bengaluru",
          province: "Karnataka",
          postal_code: "560001",
          country_code: "in",
        },
        items: [
          {
            title: "Handwoven Stole",
            quantity: 2,
            unit_price: 1000,
            tax_lines: [{ rate: 5, code: "GST", description: "GST" }],
          },
        ],
      })
      return order.id as string
    }

    it("previews without a number, issues once, reprints the same bill", async () => {
      const { api } = getSharedTestEnv()
      const orderId = await createOrder(brandChannelId)

      const preview = await api.post(
        `/admin/orders/${orderId}/tax-invoices`,
        { preview: true },
        adminHeaders
      )
      expect(preview.data.preview.invoice_number).toBeNull()
      expect(preview.data.preview.supply_type).toBe("inter_state")
      expect(preview.data.preview.totals).toMatchObject({
        taxable: 2000,
        igst: 100,
        grand_total: 2100,
      })
      const none = await api.get(`/admin/orders/${orderId}/tax-invoices`, adminHeaders)
      expect(none.data.tax_invoices).toEqual([])

      const first = await api.post(`/admin/orders/${orderId}/tax-invoices`, {}, adminHeaders)
      expect(first.data.created).toBe(true)
      const invoice = first.data.tax_invoice
      expect(invoice.invoice_number).toMatch(
        new RegExp(`^JYT/${financialYearOf(new Date())}/\\d{4}$`)
      )

      const again = await api.post(`/admin/orders/${orderId}/tax-invoices`, {}, adminHeaders)
      expect(again.data.created).toBe(false)
      expect(again.data.tax_invoice.id).toBe(invoice.id)

      const pdf = await api.get(`/admin/tax-invoices/${invoice.id}/pdf`, {
        ...adminHeaders,
        responseType: "arraybuffer",
      })
      expect(pdf.status).toBe(200)
      expect(pdf.headers["content-type"]).toContain("application/pdf")
      expect(Buffer.from(pdf.data).subarray(0, 4).toString()).toBe("%PDF")
    })

    it("refuses to re-bill a changed order unless reissued, then cancels the old one", async () => {
      const { api } = getSharedTestEnv()
      const orderId = await createOrder(brandChannelId)

      const first = (
        await api.post(`/admin/orders/${orderId}/tax-invoices`, {}, adminHeaders)
      ).data.tax_invoice

      // Adding the buyer's GSTIN changes what the bill says.
      const refused = await api
        .post(
          `/admin/orders/${orderId}/tax-invoices`,
          { buyer_gstin: "29ABCDE1234F1Z5" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(refused.status).toBeGreaterThanOrEqual(400)
      expect(refused.data.message).toContain(first.invoice_number)

      const reissued = (
        await api.post(
          `/admin/orders/${orderId}/tax-invoices`,
          { buyer_gstin: "29ABCDE1234F1Z5", reissue: true },
          adminHeaders
        )
      ).data
      expect(reissued.created).toBe(true)
      expect(reissued.cancelled_invoice_id).toBe(first.id)
      expect(reissued.tax_invoice.sequence).toBe(Number(first.sequence) + 1)

      const list = (await api.get(`/admin/orders/${orderId}/tax-invoices`, adminHeaders)).data
        .tax_invoices
      const old = list.find((i: any) => i.id === first.id)
      expect(old.status).toBe("cancelled")
      expect(old.cancel_reason).toContain(reissued.tax_invoice.invoice_number)
    })

    it("attaches the matching tax invoice to the invoice email, and not a stale one", async () => {
      const { api } = getSharedTestEnv()
      await api
        .post(
          "/admin/email-templates",
          {
            name: "Order Invoice",
            template_key: "order-invoice",
            subject: "Invoice for order #{{order_display_id}}",
            html_content: "<p>{{balance_due}}</p>",
            from: "orders@jaalyantra.com",
            template_type: "order_invoice",
          },
          adminHeaders
        )
        .catch(() => undefined) // another test may have created it

      const orderId = await createOrder(brandChannelId)

      const before = await api.post(
        `/admin/orders/${orderId}/invoice`,
        { preview: true },
        adminHeaders
      )
      expect(before.data.tax_invoice).toEqual({
        attached: false,
        reason: "No tax invoice issued for this order yet.",
      })

      const issued = (
        await api.post(`/admin/orders/${orderId}/tax-invoices`, {}, adminHeaders)
      ).data.tax_invoice

      // Watch what actually reaches the notification module, not just what the
      // route reports.
      const notifications: any = container().resolve(Modules.NOTIFICATION)
      const spy = jest.spyOn(notifications, "createNotifications")
      const sent = await api.post(`/admin/orders/${orderId}/invoice`, { confirm: true }, adminHeaders)
      expect(sent.data.sent).toBe(true)
      expect(sent.data.tax_invoice).toEqual({
        attached: true,
        invoice_number: issued.invoice_number,
      })
      const call = spy.mock.calls.find((c: any[]) => c[0]?.template === "order-invoice")
      spy.mockRestore()
      const attachment = (call?.[0] as any)?.attachments?.[0]
      expect(attachment?.filename).toBe(`${issued.invoice_number.replace(/\//g, "-")}.pdf`)
      expect(attachment?.content_type).toBe("application/pdf")
      expect(Buffer.from(attachment.content, "base64").subarray(0, 4).toString()).toBe("%PDF")

      // The order changes after the invoice: the old bill must not go out.
      // A new delivery address changes what the bill says.
      await api.post(
        `/admin/orders/${orderId}`,
        { shipping_address: { address_1: "40 Brigade Road" } },
        adminHeaders
      )
      const stale = await api.post(
        `/admin/orders/${orderId}/invoice`,
        { preview: true },
        adminHeaders
      )
      expect(stale.data.tax_invoice.attached).toBe(false)
      expect(stale.data.tax_invoice.reason).toContain(issued.invoice_number)
    })

    it("refuses an order placed on a partner's store", async () => {
      const { api } = getSharedTestEnv()
      const channel = (
        await api.post("/admin/sales-channels", { name: `Partner ${Date.now()}` }, adminHeaders)
      ).data.sales_channel
      const orderId = await createOrder(channel.id)

      const res = await api
        .post(`/admin/orders/${orderId}/tax-invoices`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.data.message).toContain("partner's store")
    })
  })
})
