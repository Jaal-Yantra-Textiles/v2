import pollDelhiveryTracking, { config } from "../poll-delhivery-tracking"

/**
 * #1758 — the hourly Delhivery poll had never run once.
 *
 * The job resolved its provider through `resolveShippingProvider`, which
 * returns a `ShippingProviderClient` adapter whose tracking method is
 * `track(ref)` — but the capability guard tested `trackShipment`, a method
 * that only exists on the RAW DelhiveryClient. The guard tripped on every
 * run, the job returned before querying anything, and a Delhivery parcel sat
 * at "Awaiting shipping" forever no matter what the carrier knew — while the
 * scheduler showed a healthy, quiet hourly job.
 *
 * These cases pin the properties that decide whether that can recur: the
 * poll must actually CALL the adapter and feed its result to the tracking
 * sync, and a provider that cannot track must be reported as the
 * misconfiguration it is rather than swallowed as a no-op.
 */

const mockResolveProvider = jest.fn()
const mockTrack = jest.fn()
const mockInventoryRun = jest.fn()
const mockOrderRun = jest.fn()

jest.mock("../../modules/shipping-providers/resolver", () => ({
  resolveShippingProvider: (...args: any[]) => mockResolveProvider(...args),
}))

jest.mock(
  "../../workflows/inventory_orders/sync-inventory-shipment-tracking",
  () => ({
    syncInventoryShipmentTrackingWorkflow: () => ({ run: mockInventoryRun }),
  })
)

jest.mock("../../workflows/orders/sync-order-shipment-tracking", () => ({
  syncOrderShipmentTrackingWorkflow: () => ({ run: mockOrderRun }),
}))

const logger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

/** What DelhiveryProviderAdapter.track returns for a parcel mid-journey. */
const trackingResult = () => ({
  carrier: "delhivery",
  awb: "10053849125307",
  current_status: "In Transit",
  current_status_code: "UD",
  estimated_delivery: "2026-09-05 23:00:00",
  origin: "New Delhi (OKHLA)",
  destination: "Bengaluru (Bommasandra)",
  events: [
    {
      timestamp: "2026-09-01T21:41:00+05:30",
      status: "Shipment booked",
      location: "Gurgaon_Bilaspur_H (Haryana)",
      scan_type: "PP",
    },
  ],
  raw: {
    ShipmentData: [
      {
        Shipment: {
          AWB: "10053849125307",
          Status: { Status: "In Transit", StatusType: "UD", StatusCode: "UD" },
          Scans: [],
        },
      },
    ],
  },
})

const fulfillment = (over: Record<string, any> = {}) => ({
  id: "ful_1",
  data: { carrier: "delhivery", waybill: "10053849125307" },
  shipped_at: "2026-09-01T16:08:00Z",
  delivered_at: null,
  canceled_at: null,
  ...over,
})

const containerWith = (fulfillments: any[], log = logger()) => {
  const graph = jest.fn().mockResolvedValue({ data: fulfillments })
  const container = {
    resolve: (key: string) => {
      if (key === "logger") return log
      if (key === "query") return { graph }
      throw new Error(`unexpected resolve(${key})`)
    },
  } as any
  return { container, log, graph }
}

const providerWithTrack = () => ({
  carrier: "delhivery",
  track: mockTrack,
})

describe("poll-delhivery-tracking", () => {
  beforeEach(() => {
    mockResolveProvider.mockReset()
    mockTrack.mockReset()
    mockInventoryRun.mockReset()
    mockOrderRun.mockReset()
  })

  it("is scheduled hourly — a poll that never runs is the whole defect", () => {
    expect(config.name).toBe("poll-delhivery-tracking")
    expect(config.schedule).toBe("0 * * * *")
  })

  it("tracks the carrier and feeds the result to the inventory tracking sync", async () => {
    const tracking = trackingResult()
    mockResolveProvider.mockResolvedValue(providerWithTrack())
    mockTrack.mockResolvedValue(tracking)
    mockInventoryRun.mockResolvedValue({
      result: { matched: true, shipment_status_changed: true },
    })

    // Noise the in-memory narrowing must skip: another carrier, and a
    // delhivery row with no waybill yet.
    const { container, log } = containerWith([
      fulfillment(),
      fulfillment({
        id: "ful_2",
        data: { carrier: "shiprocket", waybill: "SR-9" },
      }),
      fulfillment({ id: "ful_3", data: { carrier: "delhivery" } }),
    ])

    await pollDelhiveryTracking(container)

    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith({ awb: "10053849125307" })
    expect(mockInventoryRun).toHaveBeenCalledTimes(1)
    expect(mockInventoryRun).toHaveBeenCalledWith({ input: { tracking } })
    expect(mockOrderRun).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("checked=1/1 advanced=1")
    )
  })

  it("falls through to the core-order sync when no inventory shipment matches", async () => {
    const tracking = trackingResult()
    mockResolveProvider.mockResolvedValue(providerWithTrack())
    mockTrack.mockResolvedValue(tracking)
    mockInventoryRun.mockResolvedValue({ result: { matched: false } })
    mockOrderRun.mockResolvedValue({
      result: { matched: true, status_changed: true },
    })

    const { container } = containerWith([fulfillment()])

    await pollDelhiveryTracking(container)

    expect(mockInventoryRun).toHaveBeenCalledTimes(1)
    expect(mockOrderRun).toHaveBeenCalledTimes(1)
    expect(mockOrderRun).toHaveBeenCalledWith({ input: { tracking } })
  })

  it("warns and polls nothing when the configured provider has no track method", async () => {
    mockResolveProvider.mockResolvedValue({ carrier: "delhivery" })

    const { container, log, graph } = containerWith([fulfillment()])

    await pollDelhiveryTracking(container)

    expect(log.warn).toHaveBeenCalledWith(
      "[delhivery-poll] configured delhivery provider lacks a track method — misconfiguration, skipping poll"
    )
    expect(graph).not.toHaveBeenCalled()
    expect(mockTrack).not.toHaveBeenCalled()
    expect(mockInventoryRun).not.toHaveBeenCalled()
    expect(mockOrderRun).not.toHaveBeenCalled()
  })

  it("stays at debug when delhivery is simply not configured — a no-op, not a misconfiguration", async () => {
    mockResolveProvider.mockRejectedValue(
      new Error("Delhivery credentials not configured")
    )

    const { container, log, graph } = containerWith([fulfillment()])

    await pollDelhiveryTracking(container)

    expect(log.debug).toHaveBeenCalledWith(
      "[delhivery-poll] provider unavailable: Delhivery credentials not configured"
    )
    expect(log.warn).not.toHaveBeenCalled()
    expect(graph).not.toHaveBeenCalled()
  })

  it("keeps polling when one AWB fails — one dead waybill must not stop the batch", async () => {
    const tracking = trackingResult()
    mockResolveProvider.mockResolvedValue(providerWithTrack())
    mockTrack
      .mockRejectedValueOnce(new Error("Delhivery tracking failed (502)"))
      .mockResolvedValueOnce(tracking)
    mockInventoryRun.mockResolvedValue({
      result: { matched: true, shipment_status_changed: false },
    })

    const { container, log } = containerWith([
      fulfillment({
        id: "ful_a",
        data: { carrier: "delhivery", waybill: "111" },
      }),
      fulfillment({
        id: "ful_b",
        data: { carrier: "delhivery", waybill: "222" },
      }),
    ])

    await pollDelhiveryTracking(container)

    expect(mockTrack).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("AWB 111 failed")
    )
    expect(mockInventoryRun).toHaveBeenCalledTimes(1)
    expect(mockInventoryRun).toHaveBeenCalledWith({ input: { tracking } })
  })
})
