import {
  assertAwbAssigned,
  normalizeInternationalRate,
  ShiprocketClient,
} from "../client"

/**
 * Two silent-failure shapes in Shiprocket's international responses, both
 * live-verified against the account on 2026-08-06. Each one used to produce a
 * plausible-looking result instead of an error, which is why they survived: a
 * courier picker full of ₹0 options, and a "successful" label with no AWB.
 */

describe("normalizeInternationalRate", () => {
  // Verbatim shape from GET /international/courier/serviceability. Note `rate`
  // is an OBJECT and `estimated_delivery_days` is a STRING RANGE — the domestic
  // response has a numeric `rate` and numeric days, and reusing that mapper
  // turned every international quote into amount 0 / ETA NaN.
  const live = {
    courier_company_id: 381,
    courier_name: "SRX Premium",
    is_international: 1,
    etd: "Aug 16, 2026 - Aug 18, 2026",
    estimated_delivery_days: "10 - 12",
    rate: {
      courier_id: 381,
      rate: 1125,
      zone: "default",
      extra_info: { edd: { to: 12, from: 10 } },
      charge_exclusion: 0,
    },
  }

  it("reads the amount out of the nested rate object, not Number(rate)", () => {
    // The regression guard: Number({...}) is NaN, which `|| 0` quietly turned
    // into a free-looking shipment.
    expect(Number(live.rate)).toBeNaN()
    expect(normalizeInternationalRate(live).amount).toBe(1125)
  })

  it("still accepts a flat numeric rate", () => {
    expect(normalizeInternationalRate({ ...live, rate: 990 }).amount).toBe(990)
  })

  it("takes the ETA from the structured edd upper bound", () => {
    expect(normalizeInternationalRate(live).estimated_days).toBe(12)
  })

  it("parses the high end of the '10 - 12' string when edd is absent", () => {
    const { rate, ...noRateObj } = live
    expect(
      normalizeInternationalRate({ ...noRateObj, rate: 990 }).estimated_days
    ).toBe(12)
  })

  it("leaves the ETA undefined rather than NaN when unparseable", () => {
    expect(
      normalizeInternationalRate({ ...live, rate: 990, estimated_delivery_days: "" })
        .estimated_days
    ).toBeUndefined()
  })

  it("defaults currency to INR (the intl payload carries none) but honours one if sent", () => {
    expect(normalizeInternationalRate(live).currency_code).toBe("inr")
    expect(
      normalizeInternationalRate({ ...live, currency: "USD" }).currency_code
    ).toBe("usd")
  })

  it("flags the recommended courier, comparing ids as strings", () => {
    expect(normalizeInternationalRate(live, 381).is_recommended).toBe(true)
    expect(normalizeInternationalRate(live, "381").is_recommended).toBe(true)
    expect(normalizeInternationalRate(live, 384).is_recommended).toBe(false)
    // No recommendation in the payload must not mark everything recommended.
    expect(normalizeInternationalRate(live).is_recommended).toBe(false)
  })

  it("survives a courier object with nothing useful in it", () => {
    expect(normalizeInternationalRate({})).toMatchObject({
      amount: 0,
      currency_code: "inr",
      is_recommended: false,
    })
  })
})

describe("ShiprocketClient.getRates — endpoint routing by destination", () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => fetchSpy?.mockRestore())

  const client = () =>
    new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

  const spy = (payload: any) => {
    const hits: string[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        hits.push(url.replace("https://apiv2.shiprocket.in/v1/external", ""))
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        } as any
      })
    return hits
  }

  const intlPayload = {
    data: {
      recommended_courier_company_id: 381,
      available_courier_companies: [
        {
          courier_company_id: 381,
          courier_name: "SRX Premium",
          estimated_delivery_days: "10 - 12",
          rate: { rate: 1125, extra_info: { edd: { to: 12, from: 10 } } },
        },
      ],
    },
  }

  // The zero-rates bug: a foreign destination went to the India-only pincode
  // endpoint, which answers 200 with an empty courier list — an empty picker
  // rather than an error.
  it("sends a foreign destination to /international/courier/serviceability", async () => {
    const hits = spy(intlPayload)
    const rates = await client().getRates({
      origin_pincode: "176215",
      destination_pincode: "10001",
      destination_country: "US",
      weight_grams: 500,
    })
    expect(hits.some((h) => h.startsWith("/international/courier/serviceability"))).toBe(true)
    expect(hits.some((h) => h.startsWith("/courier/serviceability"))).toBe(false)
    expect(rates[0]).toMatchObject({ courier_id: 381, amount: 1125, estimated_days: 12 })
  })

  // Live-verified: the country mode 400s without pickup_postcode, so the origin
  // must be on the query string.
  it("passes the origin as pickup_postcode plus the ISO-2 delivery country", async () => {
    const hits = spy(intlPayload)
    await client().getRates({
      origin_pincode: "176215",
      destination_pincode: "",
      destination_country: "il",
      weight_grams: 750,
    })
    const url = hits.find((h) => h.startsWith("/international/"))!
    expect(url).toContain("pickup_postcode=176215")
    expect(url).toContain("delivery_country=IL")
    expect(url).toContain("weight=0.75")
    expect(url).toContain("cod=0")
  })

  it("refuses a cross-border quote with no origin instead of sending a known-400", async () => {
    spy(intlPayload)
    await expect(
      client().getRates({
        origin_pincode: "",
        destination_pincode: "",
        destination_country: "US",
        weight_grams: 500,
      })
    ).rejects.toThrow(/pickup pincode/i)
  })

  it("keeps India (and an unset country) on the domestic endpoint", async () => {
    for (const destination_country of ["IN", "India", undefined]) {
      const hits = spy({
        data: {
          recommended_courier_company_id: 5,
          available_courier_companies: [
            { courier_company_id: 5, courier_name: "Delhivery Surface", rate: 60 },
          ],
        },
      })
      const rates = await client().getRates({
        origin_pincode: "176215",
        destination_pincode: "560001",
        destination_country,
        weight_grams: 500,
      })
      expect(hits.some((h) => h.startsWith("/courier/serviceability"))).toBe(true)
      expect(hits.some((h) => h.includes("/international/"))).toBe(false)
      expect(rates[0]).toMatchObject({ amount: 60, currency_code: "inr" })
      fetchSpy.mockRestore()
    }
  })
})

describe("assertAwbAssigned", () => {
  it("passes through a real assignment", () => {
    expect(() =>
      assertAwbAssigned({ response: { data: { awb_code: "SR123456789" } } })
    ).not.toThrow()
  })

  // The live failure: HTTP 200, awb_assign_status 0, no awb_code. The old code
  // read `awb_code || ""` and reported success with a blank tracking number.
  it("throws on the 200-with-awb_assign_error shape, quoting the carrier reason", () => {
    expect(() =>
      assertAwbAssigned({
        awb_assign_status: 0,
        response: {
          data: {
            courier_id: 384,
            awb_assign_error: "Insufficient amount to label this shipment",
          },
        },
      })
    ).toThrow(/Insufficient amount to label this shipment/)
  })

  it("throws when there is no AWB and no stated reason", () => {
    expect(() => assertAwbAssigned({ response: { data: {} } })).toThrow(
      /assigned no AWB/
    )
    expect(() => assertAwbAssigned({})).toThrow(/assigned no AWB/)
  })

  it("falls back to a top-level message when present", () => {
    expect(() =>
      assertAwbAssigned({ message: "Courier not serviceable for this pincode" })
    ).toThrow(/Courier not serviceable/)
  })
})
