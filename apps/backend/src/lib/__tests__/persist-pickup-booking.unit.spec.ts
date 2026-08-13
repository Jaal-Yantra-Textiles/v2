import {
  persistPickupBooking,
  persistPickupBookingSafely,
} from "../persist-pickup-booking"

const BOOKING = {
  pickup_id: "TOKEN123",
  pickup_date: "2026-08-14",
  pickup_time: "14:00",
  carrier: "bluedart",
}

function buildScope(updateImpl?: () => Promise<any>) {
  const calls: any[] = []
  const logs: string[] = []
  const scope: any = {
    resolve: (key: string) => {
      if (key === "logger") return { error: (m: string) => logs.push(m) }
      return {
        updateFulfillment: async (id: string, payload: any) => {
          calls.push({ id, payload })
          if (updateImpl) return updateImpl()
          return {}
        },
      }
    },
  }
  return { scope, calls, logs }
}

describe("persistPickupBooking", () => {
  it("writes the booking onto fulfillment metadata", async () => {
    const { scope, calls } = buildScope()
    await persistPickupBooking(scope, "ful_1", BOOKING)

    expect(calls[0].id).toBe("ful_1")
    expect(calls[0].payload.metadata).toMatchObject({
      pickup_id: "TOKEN123",
      pickup_date: "2026-08-14",
      pickup_time: "14:00",
      carrier: "bluedart",
    })
    expect(calls[0].payload.metadata.booked_at).toEqual(expect.any(String))
  })

  it("preserves unrelated metadata already on the fulfillment", async () => {
    const { scope, calls } = buildScope()
    await persistPickupBooking(scope, "ful_1", BOOKING, {
      partner_note: "handle with care",
    })
    // Blowing away sibling keys here would silently destroy data owned by
    // completely unrelated features.
    expect(calls[0].payload.metadata.partner_note).toBe("handle with care")
  })

  it("appends to the booking history rather than overwriting it", async () => {
    const { scope, calls } = buildScope()
    await persistPickupBooking(scope, "ful_1", BOOKING, {
      pickup_bookings: [
        {
          pickup_id: "OLD",
          pickup_date: "2026-08-10",
          pickup_time: "11:00",
          booked_at: "2026-08-10T05:00:00.000Z",
        },
      ],
    })

    const history = calls[0].payload.metadata.pickup_bookings
    // A rebooked pickup must not erase the token of the previous collection —
    // that one may still be live at the carrier.
    expect(history).toHaveLength(2)
    expect(history[0].pickup_id).toBe("OLD")
    expect(history[1].pickup_id).toBe("TOKEN123")
  })
})

describe("persistPickupBookingSafely", () => {
  it("reports persisted:false instead of throwing when the write fails", async () => {
    const { scope, logs } = buildScope(async () => {
      throw new Error("db down")
    })

    // The carrier has ALREADY committed to the collection. Throwing here would
    // surface as "pickup failed" and send the operator to book a second one.
    const { persisted, record } = await persistPickupBookingSafely(
      scope,
      "ful_1",
      BOOKING
    )

    expect(persisted).toBe(false)
    expect(record.pickup_id).toBe("TOKEN123")
    // The token is the only way to call the collection off, so it must survive
    // somewhere an operator can find it.
    expect(logs.join(" ")).toContain("TOKEN123")
  })

  it("reports persisted:true on success", async () => {
    const { scope } = buildScope()
    const { persisted } = await persistPickupBookingSafely(
      scope,
      "ful_1",
      BOOKING
    )
    expect(persisted).toBe(true)
  })
})
