jest.mock("../../lib/notifications/create-partner-notification", () => ({
  createPartnerNotification: jest.fn(async () => undefined),
}))

import partnerPushOnSend from "../partner-push-on-send"
import { createPartnerNotification } from "../../lib/notifications/create-partner-notification"

const push = createPartnerNotification as jest.Mock

const run = async (name: string, data: Record<string, any>) => {
  const container: any = {
    resolve: (key: string) =>
      key === "logger"
        ? { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
        : { graph: jest.fn(async () => ({ data: [{ id: "d", name: "Bag for Paris" }] })) },
  }
  await partnerPushOnSend({ event: { name, data }, container } as any)
}

describe("partnerPushOnSend — bundles (#2500)", () => {
  beforeEach(() => push.mockClear())

  it("rings once for a bundle and opens its work order", async () => {
    await run("work_order.sent_to_partner", {
      work_order_id: "order_152",
      partner_id: "p",
      production_run_ids: ["run_b", "run_a"],
    })
    expect(push).toHaveBeenCalledTimes(1)
    const row = push.mock.calls[0][1]
    expect(row.title).toBe("2 new designs to make")
    expect(row.url).toBe("/orders/order_152")
    expect(row.data).toEqual({ order_id: "order_152", production_run_id: "run_a" })
  })

  it("skips a bundled design's own push when the bundle push went out", async () => {
    await run("production_run.sent_to_partner", {
      production_run_id: "run_a",
      partner_id: "p",
      bundle_fallback: true,
      bundle_push_sent: true,
    })
    expect(push).not.toHaveBeenCalled()
  })

  it("still pushes a single design sent on its own", async () => {
    await run("production_run.sent_to_partner", {
      production_run_id: "run_a",
      partner_id: "p",
      design_id: "d",
    })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][1].title).toBe("New design: Bag for Paris")
  })
})
