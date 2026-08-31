import { resolveShippingProvider } from "../../src/modules/shipping-providers/resolver"
import type {
  CreateShipmentInput,
  ShippingProviderClient,
} from "../../src/modules/shipping-providers/provider-interface"
import { shipglobalStubState } from "../../src/modules/shipping-providers/shipglobal/stub-fetch"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"

jest.setTimeout(120 * 1000)

/**
 * ShipGlobal carrier against a STUBBED API.
 *
 * ShipGlobal has no sandbox — the account credentials are live, so an un-stubbed
 * call would book a real, billable cross-border waybill. Rather than patch
 * `global.fetch` (which does NOT reliably intercept the in-process server's own
 * fetch in CI, #647), we set `SHIPGLOBAL_STUB=1`: the resolver injects a
 * deterministic stub transport (`shipglobal/stub-fetch.ts`) into the client, so
 * every call uses canned responses regardless of the global. Creds come from the
 * resolver's env-var fallback.
 *
 * The client is driven through `resolveShippingProvider` (not `new
 * ShipglobalClient(...)`) so the spec exercises the same resolver path the admin
 * / partner routes use — proving the carrier id resolves AND the stub is wired
 * in. The stub captures the last request body so the exact payload the client
 * would send ShipGlobal is asserted end-to-end.
 */

const GB_INPUT: CreateShipmentInput = {
  reference_id: "ord_shipglobal_test",
  payment_mode: "prepaid",
  pickup_location_name: "",
  to: {
    name: "John Smith",
    phone: "+44-7700-900123",
    email: "john@example.com",
    address_1: "4 building name",
    address_2: "5th Street",
    city: "Aberdeen",
    state: "",
    pincode: "AB32",
    country: "GB",
  },
  items: [
    {
      name: "YELLOW SAREE",
      sku: "",
      quantity: 1,
      unit_price: 54,
      hsn: "6111.20.00",
      tax: 0,
    },
  ],
  weight_grams: 500,
  dimensions_cm: { length: 10, width: 10, height: 10 },
  currency: "GBP",
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("ShipGlobal carrier (stubbed API)", () => {
    let provider: ShippingProviderClient
    let prevUsername: string | undefined
    let prevPassword: string | undefined
    let prevStub: string | undefined

    beforeAll(async () => {
      prevUsername = process.env.SHIPGLOBAL_USERNAME
      prevPassword = process.env.SHIPGLOBAL_PASSWORD
      prevStub = process.env.SHIPGLOBAL_STUB
      process.env.SHIPGLOBAL_USERNAME = "ship@example.com"
      process.env.SHIPGLOBAL_PASSWORD = "secret"
      // Make the resolver inject the canned ShipGlobal transport (no real API).
      process.env.SHIPGLOBAL_STUB = "1"

      const container = getContainer()
      provider = await resolveShippingProvider(container, "shipglobal")
    })

    afterAll(() => {
      if (prevUsername === undefined) delete process.env.SHIPGLOBAL_USERNAME
      else process.env.SHIPGLOBAL_USERNAME = prevUsername
      if (prevPassword === undefined) delete process.env.SHIPGLOBAL_PASSWORD
      else process.env.SHIPGLOBAL_PASSWORD = prevPassword
      if (prevStub === undefined) delete process.env.SHIPGLOBAL_STUB
      else process.env.SHIPGLOBAL_STUB = prevStub
    })

    it("resolves a ShipGlobal client from the carrier id", () => {
      expect(provider.carrier).toBe("shipglobal")
    })

    it("quotes the services array from rates/calculate (weight in kg)", async () => {
      const rates = await provider.getRates!({
        origin_pincode: "411014",
        destination_pincode: "AB32",
        destination_country: "GB",
        weight_grams: 1500,
      })

      expect(Array.isArray(rates)).toBe(true)
      expect(rates).toHaveLength(3)
      expect(rates[0]).toMatchObject({
        courier_name: "ShipGlobal Direct",
        amount: 300,
        currency_code: "inr",
        estimated_days: 10,
        is_recommended: true,
      })
      // The recommended flag is first-row only.
      expect(rates[1].is_recommended).toBe(false)
      expect(rates[2].courier_name).toBe("UPS")

      // The client converts grams → kg and posts ISO-2 country + postcode.
      expect(shipglobalStubState.lastRateBody).toEqual({
        package_weight: "1.5",
        country_iso_code_2: "GB",
        postcode: "AB32",
      })
    })

    it("refuses a domestic rate query (cross-border only)", async () => {
      const rates = await provider.getRates!({
        origin_pincode: "411014",
        destination_pincode: "411014",
        destination_country: "IN",
        weight_grams: 500,
      })
      expect(rates).toEqual([])
    })

    it("creates a shipment via order/add and returns the SG tracking number", async () => {
      const result = await provider.createShipment(GB_INPUT)
      expect(result.carrier).toBe("shipglobal")
      expect(result.awb).toBe("STUBSG123")
      expect(result.tracking_number).toBe("STUBSG123")
      expect(result.tracking_url).toContain("STUBSG123")
      expect(result.provider_refs?.tracking).toBe("STUBSG123")

      // The exact order/add payload the client sent the carrier.
      const body = shipglobalStubState.lastOrderBody
      expect(body.invoice_no).toBe("ord_shipglobal_test")
      expect(body.order_reference).toBe("ord_shipglobal_test")
      expect(body.invoice_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(body.package_weight).toBe("0.5")
      expect(body.package_length).toBe("10")
      expect(body.currency_code).toBe("GBP")
      expect(body.csb5_status).toBe(1)
      expect(body.customer_shipping_firstname).toBe("John")
      expect(body.customer_shipping_lastname).toBe("Smith")
      expect(body.customer_shipping_country_code).toBe("GB")
      expect(body.customer_shipping_postcode).toBe("AB32")
      expect(body.vendor_order_items).toHaveLength(1)
      // HSN normalized to digits only.
      expect(body.vendor_order_items[0].vendor_order_item_hsn).toBe("61112000")
      expect(body.vendor_order_items[0].vendor_order_item_quantity).toBe("1")
      expect(body.vendor_order_items[0].vendor_order_item_unit_price).toBe("54")
    })

    it("refuses a domestic createShipment (no India product)", async () => {
      await expect(
        provider.createShipment({ ...GB_INPUT, to: { ...GB_INPUT.to, country: "IN" } })
      ).rejects.toThrow(/cross-border only/i)
    })

    it("fetches a base64 PDF label via order/getLabel", async () => {
      const label = await provider.getLabel({
        awb: "STUBSG123",
        provider_refs: { tracking: "STUBSG123" },
      })
      expect(shipglobalStubState.lastLabelBody).toEqual({
        tracking: "STUBSG123",
        label: true,
      })
      expect(label.data).toBe("JVBERi0xLjQK")
      expect(label.format).toBe("pdf")
    })

    it("tracks via tools/tracking and normalizes the awb_-prefixed events", async () => {
      const result = await provider.track({ awb: "STUBSG123" })
      expect(shipglobalStubState.lastTrackBody).toEqual({
        tracking: "STUBSG123",
      })
      expect(result.carrier).toBe("shipglobal")
      expect(result.awb).toBe("STUBSG123")
      expect(result.current_status).toBe("DELIVERED ")
      expect(result.origin).toBe("linkers")
      expect(result.destination).toBe("US")
      expect(result.events).toHaveLength(2)
      // Newest-first: delivered on top, created below.
      expect(result.events[0].scan_type).toBe("delivered")
      expect(result.events[0].location).toBe("San Jose, CA, US")
      expect(result.events[1].scan_type).toBe("created")
      expect(result.events[1].location).toBe("Delhi, India")
    })

    it("cancels via order/cancelRefundOrder", async () => {
      const result = await provider.cancelShipment({ awb: "STUBSG123" })
      expect(shipglobalStubState.lastCancelBody).toEqual({
        tracking: "STUBSG123",
      })
      expect(result.success).toBe(true)
    })
  })
})