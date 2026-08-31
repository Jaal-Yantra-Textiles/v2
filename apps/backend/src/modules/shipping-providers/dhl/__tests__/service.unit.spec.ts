import DHLExpressFulfillmentService, {
  dhlDocumentTypeCode,
  dhlPickupYearMonth,
} from "../service"
import { DEFAULT_FLAT_FALLBACK } from "../../shiprocket/flat-fallback"

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const buildService = (options: any = {}, clientOverrides: any = {}) => {
  const svc = new DHLExpressFulfillmentService(
    { logger },
    { api_key: "k", api_secret: "s", account_number: "777", ...options }
  )
  ;(svc as any).client = {
    getRates: jest.fn(),
    addressValidate: jest.fn(),
    createShipment: jest.fn(),
    getShipmentImage: jest.fn(),
    ...clientOverrides,
  }
  return svc
}

const CONTEXT: any = {
  from_location: {
    address: { country_code: "IN", city: "Pune", postal_code: "411014" },
  },
  shipping_address: {
    country_code: "DE",
    city: "Berlin",
    postal_code: "10115",
  },
  items: [{ variant: { weight: 600 }, quantity: 2 }],
  currency_code: "eur",
}

describe("DHLExpressFulfillmentService", () => {
  it("registers under the dhl-express identifier", () => {
    expect(DHLExpressFulfillmentService.identifier).toBe("dhl-express")
  })

  it("offers the three India-origin products", async () => {
    const opts = await buildService().getFulfillmentOptions()
    expect(opts.map((o) => o.id)).toEqual([
      "dhl-express-worldwide",
      "dhl-express-1200",
      "dhl-express-easy",
    ])
    expect(opts.map((o) => (o as any).product_code)).toEqual(["P", "Y", "8"])
  })

  it("prices the BILLC line of the matched product", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockResolvedValue({
        products: [
          {
            productCode: "P",
            totalPrice: [
              { currencyType: "BILLC", price: 1250.5 },
              { currencyType: "BASE", price: 1000 },
            ],
          },
        ],
      }),
    })
    const result = await svc.calculatePrice(
      { product_code: "P" },
      {},
      CONTEXT
    )
    expect(result).toEqual({
      calculated_amount: 1250.5,
      is_calculated_price_tax_inclusive: true,
    })
  })

  it("falls back to the flat rate when DHL returns no rate", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockResolvedValue({ products: [] }),
    })
    const result = await svc.calculatePrice(
      { product_code: "P" },
      {},
      CONTEXT
    )
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
    expect(result.is_calculated_price_tax_inclusive).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  it("falls back to the flat rate when the carrier call throws", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockRejectedValue(new Error("gateway down")),
    })
    const result = await svc.calculatePrice(
      { product_code: "P" },
      {},
      CONTEXT
    )
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
    expect(result.is_calculated_price_tax_inclusive).toBe(false)
  })

  it("honours a per-country configured fallback instead of the default", async () => {
    const svc = buildService(
      { flat_fallback_amounts: { DE: 3500 } },
      { getRates: jest.fn().mockRejectedValue(new Error("no rate")) }
    )
    const result = await svc.calculatePrice(
      { product_code: "P" },
      {},
      CONTEXT
    )
    expect(result.calculated_amount).toBe(3500)
  })

  it("honours a per-currency fallback stamped on the option's data", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockRejectedValue(new Error("no rate")),
    })
    const result = await svc.calculatePrice(
      { product_code: "P", flat_fallback_amounts: { eur: 35 } },
      {},
      CONTEXT
    )
    expect(result.calculated_amount).toBe(35)
  })

  it("maps order line items onto a customs-declarable shipment and returns the label", async () => {
    const createShipment = jest.fn().mockResolvedValue({
      shipmentTrackingNumber: "JD123",
      documents: [{ typeCode: "label", content: "abc" }],
    })
    const svc = buildService(undefined, { createShipment })

    const result = await svc.createFulfillment(
      {
        from_location: {
          name: "Pune Studio",
          address: {
            country_code: "IN",
            city: "Pune",
            postal_code: "411014",
            address_1: "1 A",
          },
        },
      },
      [{ line_item_id: "item_1", title: "Cotton Shawl", quantity: 2 }],
      {
        id: "order_1",
        currency_code: "EUR",
        shipping_address: {
          first_name: "Test",
          last_name: "Buyer",
          address_1: "12 MG Road",
          city: "Berlin",
          postal_code: "10115",
          country_code: "DE",
        },
        items: [
          { id: "item_1", title: "Cotton Shawl", unit_price: 2500, variant: { weight: 600 } },
        ],
      } as any,
      { id: "ful_1" } as any
    )

    const payload = createShipment.mock.calls[0][0]
    // IN → DE is cross-border, so customs fields must be present.
    expect(payload.is_customs_declarable).toBe(true)
    expect(payload.declared_value).toBeGreaterThan(0)
    expect(payload.items).toHaveLength(1)
    // No HS code on the variant → the textile fallback.
    expect(payload.items[0].hs_code).toBe("6304.92")
    expect(payload.items[0].quantity).toBe(2)
    // 600 g × 2 → 1.2 kg billing weight.
    expect(payload.packages[0].weight).toBe(1.2)

    expect(result.data).toMatchObject({
      tracking_number: "JD123",
      carrier: "dhl-express",
      shipment_id: "JD123",
    })
    expect(result.labels).toHaveLength(1)
    expect(result.labels[0].label_url).toBe("data:application/pdf;base64,abc")
  })

  it("cancel is a documented no-op that still logs the tracking number", async () => {
    const svc = buildService()
    const out = await svc.cancelFulfillment({ data: { tracking_number: "JD123" } })
    expect(out).toEqual({})
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("JD123")
    )
  })

  it("retrieveDocuments returns [] when the fulfillment carries no tracking number", async () => {
    const svc = buildService()
    await expect(svc.retrieveDocuments({})).resolves.toEqual([])
  })

  it("retrieveDocuments maps the document type and fetches via Get Image", async () => {
    const svc = buildService(undefined, {
      getShipmentImage: jest.fn().mockResolvedValue({
        documents: [{ typeCode: "commercial-invoice", encodingFormat: "PDF", content: "EEE" }],
      }),
    })
    const docs = await svc.retrieveDocuments(
      { tracking_number: "JD123", shipped_at: "2026-08-10T10:00:00Z" },
      "invoice"
    )
    expect(docs).toEqual([
      { typeCode: "commercial-invoice", contentType: "pdf", content: "EEE" },
    ])
    expect((svc as any).client.getShipmentImage).toHaveBeenCalledWith("JD123", {
      typeCode: "commercial-invoice",
      pickupYearAndMonth: "2026-08",
    })
  })

  it("getFulfillmentDocuments prefers what is already stored on the fulfillment", async () => {
    const svc = buildService()
    const docs = await svc.getFulfillmentDocuments({
      documents: [{ typeCode: "label", imageFormat: "PDF", content: "FFF" }],
    })
    expect(docs).toEqual([
      { typeCode: "label", contentType: "pdf", content: "FFF" },
    ])
    expect((svc as any).client.getShipmentImage).not.toHaveBeenCalled()
  })
})

describe("dhlDocumentTypeCode", () => {
  it("maps invoice and label onto DHL's Get Image type codes", () => {
    expect(dhlDocumentTypeCode("invoice")).toBe("commercial-invoice")
    expect(dhlDocumentTypeCode("commercial-invoice")).toBe("commercial-invoice")
    expect(dhlDocumentTypeCode("label")).toBe("waybill")
    expect(dhlDocumentTypeCode("waybill")).toBe("waybill")
    expect(dhlDocumentTypeCode("proforma")).toBe("dhl-issued-proforma-invoice")
  })

  it("defaults an unknown type to the waybill (every shipment has a label)", () => {
    expect(dhlDocumentTypeCode("")).toBe("waybill")
    expect(dhlDocumentTypeCode(undefined)).toBe("waybill")
    expect(dhlDocumentTypeCode("gibberish")).toBe("waybill")
  })
})

describe("dhlPickupYearMonth", () => {
  it("formats an ISO date as YYYY-MM", () => {
    expect(dhlPickupYearMonth("2026-08-10T10:00:00Z")).toBe("2026-08")
    expect(dhlPickupYearMonth(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01")
  })

  it("returns undefined for an absent or unparseable value", () => {
    expect(dhlPickupYearMonth(undefined)).toBeUndefined()
    expect(dhlPickupYearMonth("")).toBeUndefined()
    expect(dhlPickupYearMonth("not-a-date")).toBeUndefined()
  })
})