import {
  describeTransferCarrier,
  describeTransferMovement,
} from "../transfer-carrier-line"

describe("describeTransferCarrier", () => {
  it("names the carrier, the AWB, the status and the pickup", () => {
    const line = describeTransferCarrier({
      carrier_state: "booked",
      shipment: {
        carrier: "delhivery",
        awb: "1234567890",
        status: "picked_up",
        pickup_scheduled_date: "2026-08-29",
        tracking_url: "https://track.example/1",
        label_url: "https://labels.example/1.pdf",
      },
    })

    expect(line.muted).toBe(false)
    expect(line.text).toContain("delhivery")
    expect(line.text).toContain("AWB 1234567890")
    expect(line.text).toContain("picked up")
    expect(line.awb).toBe("1234567890")
    expect(line.trackingUrl).toBe("https://track.example/1")
    expect(line.labelUrl).toBe("https://labels.example/1.pdf")
  })

  it("🔴 says an unreadable shipment is unreadable, not un-booked", () => {
    const line = describeTransferCarrier({
      carrier_state: "unresolved",
      shipment_id: "ship_gone",
      shipment: null,
    })

    expect(line.text).toContain("ship_gone")
    expect(line.text).not.toBe("No carrier booked")
    expect(line.muted).toBe(true)
  })

  it("states a van run plainly", () => {
    const line = describeTransferCarrier({
      carrier_state: "not_booked",
      shipment: null,
    })

    expect(line.text).toBe("No carrier booked")
    expect(line.muted).toBe(true)
  })

  it("never prints a null field as text", () => {
    // A booking that failed part-way leaves a row with empty fields. "null ·
    // AWB null" would be worse than the toast this replaces.
    const line = describeTransferCarrier({
      carrier_state: "booked",
      shipment: { carrier: null, awb: null, status: null, pickup_scheduled_date: null },
    })

    expect(line.text).not.toMatch(/null|undefined/)
    expect(line.text).toBe("Carrier")
  })

  it("treats a row with no carrier_state at all as un-booked", () => {
    // Anything served by a route that predates the hydration.
    expect(describeTransferCarrier({}).text).toBe("No carrier booked")
  })
})

describe("describeTransferMovement", () => {
  it("says nothing until something has happened", () => {
    expect(describeTransferMovement({})).toBeNull()
  })

  it("reports shipped and received separately", () => {
    const text = describeTransferMovement({
      shipped_at: "2026-08-29T00:00:00.000Z",
      received_at: "2026-08-31T00:00:00.000Z",
    })

    expect(text).toContain("shipped")
    expect(text).toContain("received")
  })
})
