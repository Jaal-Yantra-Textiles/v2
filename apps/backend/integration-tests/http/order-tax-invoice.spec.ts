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

      // Seller address = a location on the brand channel (Dharamshala).
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
      // The dispatch point is the location the order's channel sells from.
      await api.post(
        `/admin/stock-locations/${location.id}/sales-channels`,
        { add: [brandChannelId] },
        adminHeaders
      )
      // The seller address is the GST registration's (seeded GSTIN 07 = Delhi).
      await api.post(
        "/admin/platform-tax-identities/ptid_jyt_in/registered-address",
        {
          address_1: "12 Connaught Place",
          city: "New Delhi",
          province: "Delhi",
          postal_code: "110001",
        },
        adminHeaders
      )
    })

    /** 2 × ₹1,000 + 5% GST, shipped to Karnataka (or picked up: no address). */
    const createOrder = async (salesChannelId: string, opts: { pickup?: boolean } = {}) => {
      const orderService: any = container().resolve(Modules.ORDER)
      const order = await orderService.createOrders({
        sales_channel_id: salesChannelId,
        currency_code: "inr",
        email: `tax-invoice-${Date.now()}@jaalyantra.test`,
        status: "pending",
        shipping_address: opts.pickup
          ? { first_name: "Cherry", last_name: "M", country_code: "in" }
          : {
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
      // Seller address is the GST registration's, not the warehouse's.
      expect(preview.data.preview.seller.lines.join(" ")).toContain("Connaught Place")
      expect(preview.data.preview.seller.gstin).toBe("07AAGCJ0494A1ZV")
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

    it("bills a pickup at Dharamshala under the Delhi GSTIN as IGST", async () => {
      const { api } = getSharedTestEnv()
      const orderId = await createOrder(brandChannelId, { pickup: true })
      const m = (
        await api.post(`/admin/orders/${orderId}/tax-invoices`, { preview: true }, adminHeaders)
      ).data.preview
      expect(m.supply_type).toBe("inter_state")
      expect(m.place_of_supply).toBe("Himachal Pradesh (02) - handed over at dispatch")
      expect(m.totals).toMatchObject({ igst: 100, cgst: 0, sgst: 0 })
    })

    it("refuses a registered address outside the GSTIN's state", async () => {
      const { api } = getSharedTestEnv()
      const res = await api
        .post(
          "/admin/platform-tax-identities/ptid_jyt_in/registered-address",
          { address_1: "Ram Nagar Road", city: "Dharamshala", province: "Himachal Pradesh", postal_code: "176215" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.message).toContain("Delhi (07)")
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
