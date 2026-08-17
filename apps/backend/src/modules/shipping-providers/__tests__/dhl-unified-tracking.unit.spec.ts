import {
  DhlUnifiedTrackingClient,
  classifyDhlStatus,
  normalizeDhlUnifiedTracking,
} from "../dhl-unified-tracking"

/**
 * Pinned against a REAL payload captured live on 2026-08-13 from
 * `GET https://api-eu.dhl.com/track/shipments?trackingNumber=21089967146`
 * with the approved DHL API key — the Blue Dart test waybill from the
 * integration report. Written from the wire, not from the docs.
 */
const LIVE_PAYLOAD = {
  shipments: [
    {
      id: "21089967146",
      service: "bluedart",
      origin: { address: { addressLocality: "DHARAMSHALA", countryCode: "IN" } },
      destination: { address: { addressLocality: "DHARAMSHALA", countryCode: "IN" } },
      status: {
        timestamp: "2026-08-13T10:02:00",
        location: {
          address: {
            addressLocality: "DHARAMSHALA, DHARAMSHALA, HIMACHAL PRADESH",
            countryCode: "IN",
          },
        },
        statusCode: "pre-transit",
        status: "PU",
        description: "PICKUP HAS BEEN REGISTERED",
      },
      returnFlag: false,
      details: { product: { productCode: "D", productName: "Documents" } },
      events: [
        {
          timestamp: "2026-08-13T10:02:00",
          location: {
            address: { addressLocality: "DHARAMSHALA, DHARAMSHALA, HIMACHAL PRADESH" },
          },
          statusCode: "pre-transit",
          status: "PU",
          description: "PICKUP HAS BEEN REGISTERED ",
        },
        {
          timestamp: "2026-08-13T09:48:00",
          location: { address: { addressLocality: "BLUE DART CENTRE, MUMBAI, MAHARASHTRA" } },
          statusCode: "transit",
          status: "PU",
          description: "SHIPPER INSTRUCTED TO RTO THE SHIPMENT ",
        },
        {
          timestamp: "2026-08-13T09:47:00",
          location: {
            address: { addressLocality: "DHARAMSHALA, DHARAMSHALA, HIMACHAL PRADESH" },
          },
          statusCode: "pre-transit",
          status: "PU",
          description: "Online shipment booked ",
        },
      ],
    },
  ],
}

describe("normalizeDhlUnifiedTracking", () => {
  it("maps the live Blue Dart payload onto the uniform tracking shape", () => {
    const result = normalizeDhlUnifiedTracking(LIVE_PAYLOAD, "21089967146", "bluedart")
    expect(result).toMatchObject({
      carrier: "bluedart",
      awb: "21089967146",
      current_status: "PICKUP HAS BEEN REGISTERED",
      current_status_code: "pre-transit",
    })
    expect(result.events).toHaveLength(3)
  })

  it("shows the human scan text, not the two-letter carrier code", () => {
    const result = normalizeDhlUnifiedTracking(LIVE_PAYLOAD, "21089967146", "bluedart")
    // "PU" means nothing to an operator reading a timeline.
    expect(result.events[0].status).toBe("PICKUP HAS BEEN REGISTERED")
    expect(result.events[0].location).toBe("DHARAMSHALA, DHARAMSHALA, HIMACHAL PRADESH")
  })

  it("falls back to the given AWB when the payload has no shipment", () => {
    const result = normalizeDhlUnifiedTracking({ shipments: [] }, "FALLBACK", "bluedart")
    expect(result.awb).toBe("FALLBACK")
    expect(result.events).toEqual([])
  })
})

describe("classifyDhlStatus", () => {
  it("classifies an RTO as returned even though DHL codes it as plain transit", () => {
    // The live payload proves this case is real: statusCode "transit" with
    // "SHIPPER INSTRUCTED TO RTO THE SHIPMENT". Treating it as ordinary transit
    // makes a parcel coming BACK look like one still going out.
    expect(classifyDhlStatus("transit", "SHIPPER INSTRUCTED TO RTO THE SHIPMENT ")).toBe(
      "returned"
    )
  })

  it("classifies the coarse codes", () => {
    expect(classifyDhlStatus("pre-transit", "Online shipment booked")).toBe("created")
    expect(classifyDhlStatus("transit", "In transit")).toBe("in_transit")
    expect(classifyDhlStatus("delivered", "Delivered")).toBe("delivered")
    expect(classifyDhlStatus("failure", "Delivery exception")).toBe("exception")
  })

  /**
   * This test used to assert the opposite, and that is why the defect survived:
   * "PICKUP HAS BEEN REGISTERED" is what Blue Dart emits when a pickup is
   * BOOKED, and it keeps emitting it until someone physically collects. Order
   * 83 sat on this exact scan from 14 to 17 Aug 2026 — uncollected — while the
   * timeline told operators it had been picked up. Note the statusCode in the
   * same payload: `pre-transit`. The carrier was contradicting us in the very
   * response we were misreading.
   */
  it("does not read a REGISTERED pickup as a collection", () => {
    expect(classifyDhlStatus("pre-transit", "PICKUP HAS BEEN REGISTERED")).toBe(
      "pickup_scheduled"
    )
    expect(classifyDhlStatus("pre-transit", "Pickup Scheduled")).toBe(
      "pickup_scheduled"
    )
    expect(classifyDhlStatus("pre-transit", "AWAITING PICKUP")).toBe(
      "pickup_scheduled"
    )
  })

  it("still reads a real collection as picked_up", () => {
    expect(classifyDhlStatus("transit", "SHIPMENT PICKED UP")).toBe("picked_up")
    expect(classifyDhlStatus("transit", "Shipment collected from shipper")).toBe(
      "picked_up"
    )
  })

  it("keeps reading a cancelled pickup as cancelled, not scheduled", () => {
    expect(classifyDhlStatus("pre-transit", "PICKUP HAS BEEN CANCELLED")).toBe(
      "cancelled"
    )
  })

  it("never guesses delivered for an unrecognised scan", () => {
    // #1206's rule: guessing delivery closes an order whose parcel is still
    // moving, and nobody finds out until the customer complains.
    expect(classifyDhlStatus(undefined, "SOME NOVEL SCAN NOBODY MAPPED")).toBe("in_transit")
    expect(classifyDhlStatus("unknown", "")).toBe("in_transit")
  })

  it("does not read 'undelivered' as delivered", () => {
    expect(classifyDhlStatus("failure", "UNDELIVERED - CONSIGNEE UNAVAILABLE")).toBe(
      "exception"
    )
  })
})

describe("DhlUnifiedTrackingClient", () => {
  const clientWith = (status: number, body: any) => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(String(url))
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      }
    }) as unknown as typeof fetch
    return { client: new DhlUnifiedTrackingClient({ api_key: "k", fetchImpl }), calls }
  }

  it("sends the tracking number and the carrier service", async () => {
    const { client, calls } = clientWith(200, LIVE_PAYLOAD)
    await client.track("21089967146", "bluedart")
    expect(calls[0]).toContain("trackingNumber=21089967146")
    expect(calls[0]).toContain("service=bluedart")
  })

  it("names a 404 as 'not scanned yet' rather than a failure", async () => {
    // A freshly generated waybill is legitimately absent for a while; reporting
    // that as an error sends operators chasing a shipment that is fine.
    const { client } = clientWith(404, { detail: "no data" })
    await expect(client.track("NEW")).rejects.toThrow(/no tracking data .* yet/i)
  })

  it("surfaces other failures with their status", async () => {
    const { client } = clientWith(401, { detail: "invalid key" })
    await expect(client.track("X")).rejects.toThrow(/401/)
  })
})
