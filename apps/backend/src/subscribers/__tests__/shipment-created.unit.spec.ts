import shipmentCreatedHandler from "../shipment-created"

const mockRun = jest.fn()

jest.mock("../../workflows/email/send-notification-email", () => ({
  sendShipmentStatusEmail: jest.fn(() => ({ run: mockRun })),
}))

const buildContainer = (labels: any) => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const query = {
    graph: jest.fn(async () => ({ data: [{ id: "ful_1", labels }] })),
  }

  return {
    logger,
    query,
    container: {
      resolve: (key: string) => (key === "logger" ? logger : query),
    } as any,
  }
}

const run = async (labels: any, data: any = {}) => {
  const ctx = buildContainer(labels)
  await shipmentCreatedHandler({
    event: { data: { id: "ful_1", ...data } },
    container: ctx.container,
  } as any)
  return ctx
}

describe("shipment-created subscriber", () => {
  beforeEach(() => {
    mockRun.mockReset()
  })

  it("emails the customer when a label carries a tracking number", async () => {
    await run([{ id: "fulla_1", tracking_number: "21091376574" }])

    expect(mockRun).toHaveBeenCalledWith({
      input: { shipment_id: "ful_1", status: "shipped" },
    })
  })

  /**
   * Order 83, 2026-08-17: core's create-shipment writes `labels: input.labels ??
   * []` and the fulfillment write REPLACES rather than merges, so marking the
   * order shipped without echoing the labels back deleted the Blue Dart label.
   * The mail went out seconds later with an empty tracking block — "your items
   * are on the way", nothing to click.
   */
  it("refuses to send a shipped notice with nothing to track", async () => {
    const ctx = await run([])

    expect(mockRun).not.toHaveBeenCalled()
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("ful_1")
    )
  })

  it("refuses when the labels exist but carry no number", async () => {
    await run([{ id: "fulla_1", tracking_number: "" }])

    expect(mockRun).not.toHaveBeenCalled()
  })

  it("still honours no_notification without querying at all", async () => {
    const ctx = await run([{ id: "fulla_1", tracking_number: "X" }], {
      no_notification: true,
    })

    expect(mockRun).not.toHaveBeenCalled()
    expect(ctx.query.graph).not.toHaveBeenCalled()
  })
})
