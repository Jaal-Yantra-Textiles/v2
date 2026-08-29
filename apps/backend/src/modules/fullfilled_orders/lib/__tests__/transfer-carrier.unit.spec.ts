import { attachCarrierToTransfers } from "../transfer-carrier"

/**
 * The carrier behind a goods transfer (#1553). The case that matters most is
 * the third: a `shipment_id` we cannot resolve must not read as "nobody booked
 * a carrier" — that would send an operator to re-book a hop already collected.
 */
describe("attachCarrierToTransfers", () => {
  const transfer = (over: Record<string, any> = {}) => ({
    id: "gtrf_1",
    production_run_id: "prod_run_1",
    shipment_id: null,
    ...over,
  })

  const shipment = (over: Record<string, any> = {}) => ({
    id: "ship_1",
    carrier: "delhivery",
    awb: "1234567890",
    tracking_number: "1234567890",
    tracking_url: "https://track.example/1234567890",
    label_url: "https://labels.example/1234567890.pdf",
    status: "picked_up",
    pickup_location_name: "Shramdaan",
    pickup_scheduled_date: "2026-08-29",
    ...over,
  })

  it("surfaces the AWB that used to live only in a toast", () => {
    const [row] = attachCarrierToTransfers(
      [transfer({ shipment_id: "ship_1" })],
      [shipment()]
    )

    expect(row.carrier_state).toBe("booked")
    expect(row.shipment?.awb).toBe("1234567890")
    expect(row.shipment?.tracking_url).toBe("https://track.example/1234567890")
    expect(row.shipment?.status).toBe("picked_up")
  })

  it("calls a van run between our own locations what it is — not booked", () => {
    const [row] = attachCarrierToTransfers([transfer()], [])

    expect(row.carrier_state).toBe("not_booked")
    expect(row.shipment).toBeNull()
  })

  it("🔴 does NOT report an unreadable shipment as an un-booked hop", () => {
    // A waybill exists. We just cannot see it. Saying "no carrier" here is how
    // someone re-books goods the carrier already collected.
    const [row] = attachCarrierToTransfers(
      [transfer({ shipment_id: "ship_gone" })],
      []
    )

    expect(row.carrier_state).toBe("unresolved")
    expect(row.shipment).toBeNull()
  })

  it("never ships the raw carrier payload to the client", () => {
    const [row] = attachCarrierToTransfers(
      [transfer({ shipment_id: "ship_1" })],
      [shipment({ provider_refs: { account: "SECRET" }, metadata: { raw: "…" } } as any)]
    )

    expect(row.shipment).not.toHaveProperty("provider_refs")
    expect(row.shipment).not.toHaveProperty("metadata")
  })

  it("keeps every transfer field it was given", () => {
    const [row] = attachCarrierToTransfers(
      [transfer({ quantity: 9, reason: "finishing", notes: "handle with care" })],
      []
    )

    expect(row.quantity).toBe(9)
    expect(row.reason).toBe("finishing")
    expect(row.notes).toBe("handle with care")
  })

  it("resolves each transfer against its OWN shipment", () => {
    const rows = attachCarrierToTransfers(
      [
        transfer({ id: "gtrf_a", shipment_id: "ship_1" }),
        transfer({ id: "gtrf_b", shipment_id: "ship_2" }),
      ],
      [shipment(), shipment({ id: "ship_2", awb: "9999999999" })]
    )

    expect(rows.map((r) => r.shipment?.awb)).toEqual(["1234567890", "9999999999"])
  })

  it("tolerates a shipment row whose carrier fields are empty", () => {
    // A booking that failed part-way still has a row. `booked` with null facts
    // is honest; a partially-filled shell pretending to be complete is not.
    const [row] = attachCarrierToTransfers(
      [transfer({ shipment_id: "ship_1" })],
      [{ id: "ship_1" }]
    )

    expect(row.carrier_state).toBe("booked")
    expect(row.shipment?.awb).toBeNull()
    expect(row.shipment?.carrier).toBeNull()
  })
})
