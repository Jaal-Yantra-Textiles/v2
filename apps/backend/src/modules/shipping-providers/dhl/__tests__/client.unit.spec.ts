import { DHLClient, dhlDateTime, normalizeDhlDocuments } from "../client"

/**
 * The DHL Express client carries `fetchImpl` injection specifically so the
 * transport can be stubbed without patching the global. The stub below returns
 * `{ ok, status, text }` because `request<T>()` reads `res.text()` and parses
 * it itself (DHL errors come back as JSON `detail`).
 */
const clientWith = (status: number, body: any) => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }
  }) as unknown as typeof fetch
  return {
    client: new DHLClient({
      api_key: "k",
      api_secret: "s",
      account_number: "777",
      fetchImpl,
    }),
    calls,
  }
}

describe("DHLClient", () => {
  it("builds the rates URL with account, lane, weight and metric units", async () => {
    const { client, calls } = clientWith(200, { products: [] })
    await client.getRates({
      origin_country: "IN",
      origin_city: "Pune",
      origin_postal_code: "411014",
      dest_country: "US",
      dest_city: "New York",
      dest_postal_code: "10001",
      weight: 1.2,
    })
    const url = calls[0].url
    expect(url).toContain("accountNumber=777")
    expect(url).toContain("originCountryCode=IN")
    expect(url).toContain("destinationCountryCode=US")
    expect(url).toContain("weight=1.2")
    expect(url).toContain("unitOfMeasurement=metric")
  })

  it("address-validates a delivery lane with the delivery type", async () => {
    const { client, calls } = clientWith(200, { address: [{ cityName: "Pune" }] })
    await client.addressValidate({
      type: "delivery",
      country_code: "IN",
      postal_code: "411014",
      city: "Pune",
    })
    expect(calls[0].url).toContain("/address-validate")
    expect(calls[0].url).toContain("type=delivery")
    expect(calls[0].url).toContain("postalCode=411014")
  })

  it("builds a customs-declarable shipment body with declared value and line items", async () => {
    const { client, calls } = clientWith(200, { shipmentTrackingNumber: "JD123" })
    await client.createShipment({
      shipper: {
        name: "Warehouse",
        address: { line1: "1 A", city: "Pune", postal_code: "411014", country_code: "IN" },
      },
      receiver: {
        name: "Buyer",
        address: { line1: "2 B", city: "Berlin", postal_code: "10115", country_code: "DE" },
      },
      packages: [{ weight: 1.2 }],
      product_code: "P",
      is_customs_declarable: true,
      declared_value: 5000,
      declared_value_currency: "EUR",
      items: [
        {
          description: "Cotton shawl",
          price: 50,
          quantity: 2,
          hs_code: "6304.92",
          weight_kg: 0.6,
          manufacturer_country: "IN",
        },
      ],
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.productCode).toBe("P")
    expect(body.content.isCustomsDeclarable).toBe(true)
    expect(body.content.declaredValue).toBe(5000)
    expect(body.content.exportDeclaration.lineItems).toHaveLength(1)
    expect(body.content.exportDeclaration.lineItems[0].commodityCodes).toEqual([
      { typeCode: "outbound", value: "6304.92" },
    ])
  })

  it("omits the export declaration for a non-declarable shipment", async () => {
    const { client, calls } = clientWith(200, { shipmentTrackingNumber: "JD456" })
    await client.createShipment({
      shipper: {
        name: "W",
        address: { line1: "1", city: "Pune", postal_code: "411014", country_code: "IN" },
      },
      receiver: {
        name: "B",
        address: { line1: "2", city: "Mumbai", postal_code: "400001", country_code: "IN" },
      },
      packages: [{ weight: 0.5 }],
      is_customs_declarable: false,
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.content.isCustomsDeclarable).toBe(false)
    expect(body.content.exportDeclaration).toBeUndefined()
  })

  it("retrieves documents via the Get Image endpoint with type and pickup month", async () => {
    const { client, calls } = clientWith(200, { documents: [] })
    await client.getShipmentImage("JD123", {
      typeCode: "commercial-invoice",
      pickupYearAndMonth: "2026-08",
    })
    expect(calls[0].url).toContain("/shipments/JD123/get-image")
    expect(calls[0].url).toContain("typeCode=commercial-invoice")
    expect(calls[0].url).toContain("pickupYearAndMonth=2026-08")
    expect(calls[0].url).toContain("shipperAccountNumber=777")
  })

  it("names a non-OK response with its status and DHL detail", async () => {
    const { client } = clientWith(401, { detail: "invalid key" })
    await expect(
      client.getRates({
        origin_country: "IN",
        origin_city: "Pune",
        origin_postal_code: "411014",
        dest_country: "US",
        dest_city: "New York",
        dest_postal_code: "10001",
        weight: 1,
      })
    ).rejects.toThrow(/401/)
  })

  it("surfaces DHL's additionalDetails field problems, not just the summary", async () => {
    const { client } = clientWith(400, {
      detail: "Multiple problems found, see Additional Details",
      additionalDetails: ["200003: NetWeight KGM MEASUREMENT VALUE IS MISSING"],
    })
    await expect(
      client.getRates({
        origin_country: "IN",
        origin_city: "Pune",
        origin_postal_code: "411014",
        dest_country: "US",
        dest_city: "New York",
        dest_postal_code: "10001",
        weight: 1,
      })
    ).rejects.toThrow(/NetWeight KGM MEASUREMENT VALUE IS MISSING/)
  })

  it("sends each landed-cost line's net weight and a tariff rate type", async () => {
    const { client, calls } = clientWith(200, { products: [] })
    await client.landedCost({
      shipper: {
        name: "W",
        address: { line1: "1", city: "Pune", postal_code: "411014", country_code: "IN" },
      },
      receiver: {
        name: "B",
        address: { line1: "2", city: "New York", postal_code: "10001", country_code: "US" },
      },
      weight: 1.2,
      currency_code: "USD",
      declared_value: 120,
      items: [
        { name: "Cotton Shawl", hs_code: "63049200", origin_country: "IN", quantity: 2, unit_price: 60, weight: 0.6 },
      ],
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.items[0].weight).toBe(0.6)
    expect(body.items[0].weightUnitOfMeasurement).toBe("metric")
    expect(body.items[0].commodityCode).toBe("63049200")
    // With a partial HS code the GTS calculator needs to know which end of the
    // duty range to quote — the client defaults to the conservative upper bound.
    expect(body.items[0].estimatedTariffRateType).toBe("highest_rate")
  })

  it("lets the caller pick the tariff rate type for a landed-cost line", async () => {
    const { client, calls } = clientWith(200, { products: [] })
    await client.landedCost({
      shipper: {
        name: "W",
        address: { line1: "1", city: "Pune", postal_code: "411014", country_code: "IN" },
      },
      receiver: {
        name: "B",
        address: { line1: "2", city: "New York", postal_code: "10001", country_code: "US" },
      },
      weight: 1.2,
      currency_code: "USD",
      declared_value: 120,
      items: [
        {
          name: "Cotton Shawl",
          hs_code: "63049200",
          origin_country: "IN",
          quantity: 2,
          unit_price: 60,
          weight: 0.6,
          estimated_tariff_rate_type: "preferential_rate",
        },
      ],
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.items[0].estimatedTariffRateType).toBe("preferential_rate")
  })

  it("builds a pickup body with an accounts ARRAY and shipper customerDetails", async () => {
    const { client, calls } = clientWith(200, { dispatchConfirmationNumber: "PRG1" })
    await client.createPickup({
      shipper: {
        name: "JYT Warehouse",
        phone: "919999999999",
        email: "w@e.com",
        company_name: "JYT",
        address: { line1: "1 A", city: "Pune", postal_code: "411014", country_code: "IN" },
      },
      close_time: "18:00",
      location: "reception",
      location_type: "business",
      shipments: [
        {
          product_code: "P",
          is_customs_declarable: true,
          packages: [{ weight: 1.2 }],
          shipment_tracking_number: "123456790",
        },
      ],
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(calls[0].url).toContain("/pickups")
    // The old code sent a singular `account` and a `pickupLocation` — both
    // rejected by the spec (which wants `accounts[]` + `customerDetails`).
    expect(body.accounts).toEqual([{ typeCode: "shipper", number: "777" }])
    expect(body.account).toBeUndefined()
    expect(body.pickupLocation).toBeUndefined()
    expect(body.customerDetails.shipperDetails.postalAddress.cityName).toBe("Pune")
    expect(body.shipmentDetails[0].productCode).toBe("P")
    expect(body.shipmentDetails[0].shipmentTrackingNumber).toBe("123456790")
    expect(body.closeTime).toBe("18:00")
  })

  it("selects the mock server when mock is set, sandbox when sandbox is set", async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      return { ok: true, status: 200, text: async () => JSON.stringify({}) }
    }) as unknown as typeof fetch

    const mock = new DHLClient({ api_key: "k", api_secret: "s", mock: true, fetchImpl })
    await mock.getRates({
      origin_country: "IN", origin_city: "Pune", origin_postal_code: "411014",
      dest_country: "US", dest_city: "NY", dest_postal_code: "10001", weight: 1,
    })
    expect(urls[urls.length - 1]).toContain("https://api-mock.dhl.com/mydhlapi")

    const sandbox = new DHLClient({ api_key: "k", api_secret: "s", sandbox: true, fetchImpl })
    await sandbox.getRates({
      origin_country: "IN", origin_city: "Pune", origin_postal_code: "411014",
      dest_country: "US", dest_city: "NY", dest_postal_code: "10001", weight: 1,
    })
    expect(urls[urls.length - 1]).toContain("https://express.api.dhl.com/mydhlapi/test")

    const prod = new DHLClient({ api_key: "k", api_secret: "s", fetchImpl })
    await prod.getRates({
      origin_country: "IN", origin_city: "Pune", origin_postal_code: "411014",
      dest_country: "US", dest_city: "NY", dest_postal_code: "10001", weight: 1,
    })
    expect(urls[urls.length - 1]).toContain("https://express.api.dhl.com/mydhlapi")
    expect(urls[urls.length - 1]).not.toContain("/test")
  })
})

describe("dhlDateTime", () => {
  it("formats with an explicit GMT offset and no Z suffix", () => {
    const out = dhlDateTime(new Date(Date.UTC(2026, 7, 29, 10, 30, 5)))
    // The exact offset depends on the machine's TZ, but the shape is fixed:
    // no `Z`, no fractional seconds, and a ` GMT±HH:MM` suffix.
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} GMT[+-]\d{2}:\d{2}$/)
    expect(out).not.toContain("Z")
  })

  it("defaults to the current time in the same shape", () => {
    expect(dhlDateTime()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} GMT[+-]\d{2}:\d{2}$/
    )
  })
})

describe("normalizeDhlDocuments", () => {
  it("flattens the create-shipment bare documents array (imageFormat vocabulary)", () => {
    const res = {
      documents: [
        { typeCode: "label", imageFormat: "PDF", content: "AAA" },
        { typeCode: "invoice", imageFormat: "PDF", content: "BBB" },
      ],
    }
    expect(normalizeDhlDocuments(res)).toEqual([
      { typeCode: "label", contentType: "pdf", content: "AAA" },
      { typeCode: "invoice", contentType: "pdf", content: "BBB" },
    ])
  })

  it("flattens the Get Image response (encodingFormat vocabulary)", () => {
    const res = {
      documents: [
        { typeCode: "commercial-invoice", encodingFormat: "PDF", content: "CCC" },
      ],
    }
    expect(normalizeDhlDocuments(res)).toEqual([
      { typeCode: "commercial-invoice", contentType: "pdf", content: "CCC" },
    ])
  })

  it("drops rows with no base64 content rather than returning a dead reference", () => {
    const res = {
      documents: [
        { typeCode: "label", imageFormat: "PDF", content: "" },
        { typeCode: "invoice", imageFormat: "PDF", content: "DDD" },
      ],
    }
    expect(normalizeDhlDocuments(res)).toHaveLength(1)
    expect(normalizeDhlDocuments(res)[0].typeCode).toBe("invoice")
  })

  it("returns an empty list for an unrecognised payload", () => {
    expect(normalizeDhlDocuments(undefined)).toEqual([])
    expect(normalizeDhlDocuments({ shipments: [] })).toEqual([])
  })
})