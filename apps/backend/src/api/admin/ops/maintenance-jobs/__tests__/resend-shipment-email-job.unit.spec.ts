/**
 * #1294 — guards on the tracking re-send.
 *
 * This job emails a real customer and cannot be undone, so the interesting
 * assertions are the refusals: the cases where sending would be worse than
 * staying quiet.
 */
const runMock = jest.fn().mockResolvedValue({})

jest.mock("../../../../../workflows/email/send-notification-email", () => ({
  sendShipmentStatusEmail: () => ({ run: runMock }),
}))

import { resendShipmentEmailJob } from "../resend-shipment-email-job"

const FULFILLMENT = {
  id: "ful_79",
  shipped_at: "2026-08-08T13:10:05.725Z",
  canceled_at: null,
  labels: [{ tracking_number: "N40878729", tracking_url: "" }],
  order: { id: "order_79", display_id: 79, email: "buyer@example.com" },
}

const containerWith = (fulfillment: any) => ({
  resolve: () => ({
    graph: async () => ({ data: fulfillment ? [fulfillment] : [] }),
  }),
})

const run = (fulfillment: any, opts: any = {}) =>
  (resendShipmentEmailJob.run as any)(containerWith(fulfillment), {
    dry_run: opts.dry_run ?? true,
    params: { fulfillment_id: "ful_79", ...(opts.params || {}) },
  })

beforeEach(() => runMock.mockClear())

describe("resend-shipment-email", () => {
  it("dry-run names the recipient AND the tracking number, and sends nothing", async () => {
    // The number is the whole message, so it has to be checkable before send —
    // a second WRONG tracking mail is worse than the first.
    const res = await run(FULFILLMENT)
    expect(res.applied).toBe(false)
    expect(res.summary).toContain("buyer@example.com")
    expect(res.summary).toContain("N40878729")
    expect(runMock).not.toHaveBeenCalled()
  })

  it("sends the current label's tracking when applied", async () => {
    const res = await run(FULFILLMENT, { dry_run: false })
    expect(res.applied).toBe(true)
    expect(runMock).toHaveBeenCalledWith({
      input: { shipment_id: "ful_79", status: "shipped" },
    })
    expect(res.summary).toContain("N40878729")
  })

  it("refuses when no label carries a tracking number", async () => {
    // An empty tracking block is a worse silence than no email at all.
    await expect(
      run({ ...FULFILLMENT, labels: [] })
    ).rejects.toThrow(/no tracking number/i)
    await expect(
      run({ ...FULFILLMENT, labels: [{ tracking_number: null }] })
    ).rejects.toThrow(/no tracking number/i)
  })

  it("refuses on a cancelled fulfillment", async () => {
    // Emailing tracking for a parcel that is not going out is the exact
    // confusion this job exists to clean up.
    await expect(
      run({ ...FULFILLMENT, canceled_at: "2026-08-09T17:50:43.527Z" })
    ).rejects.toThrow(/cancelled/i)
    expect(runMock).not.toHaveBeenCalled()
  })

  it("refuses when the order has nobody to email", async () => {
    await expect(
      run({ ...FULFILLMENT, order: { id: "order_79", email: null } })
    ).rejects.toThrow(/no email address/i)
  })

  it("refuses an unknown fulfillment rather than emailing blindly", async () => {
    await expect(run(null)).rejects.toThrow(/not found/i)
  })

  it("supports the delivered template", async () => {
    const res = await run(FULFILLMENT, {
      dry_run: false,
      params: { status: "delivered" },
    })
    expect(runMock).toHaveBeenCalledWith({
      input: { shipment_id: "ful_79", status: "delivered" },
    })
    expect(res.changes[0].field).toBe("order-shipment-delivered")
  })
})
