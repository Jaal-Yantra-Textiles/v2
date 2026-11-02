jest.mock("../../workflows/designs/lib/notify-partner-of-work-order", () => ({
  notifyPartnerOfWorkOrder: jest.fn(),
}))

import workOrderSentWhatsapp from "../work-order-sent-whatsapp"
import { notifyPartnerOfWorkOrder } from "../../workflows/designs/lib/notify-partner-of-work-order"

const notify = notifyPartnerOfWorkOrder as jest.Mock

const run = async (data: Record<string, any>) => {
  const emit = jest.fn(async (_e: any) => undefined)
  const container: any = {
    resolve: (key: string) =>
      key === "logger"
        ? { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
        : { emit },
  }
  await workOrderSentWhatsapp({
    event: { name: "work_order.sent_to_partner", data },
    container,
  } as any)
  return emit
}

const bundle = {
  work_order_id: "order_152",
  partner_id: "partner_shramdaan",
  production_run_ids: ["run_a", "run_b", "run_c"],
  design_ids_by_run: { run_a: "d_a", run_b: "d_b", run_c: "d_c" },
}

describe("workOrderSentWhatsapp (#2500)", () => {
  beforeEach(() => {
    notify.mockReset()
    delete process.env.WORK_ORDER_SENT_WHATSAPP
  })

  it("sends ONE message for the bundle and no per-design messages", async () => {
    notify.mockResolvedValue({ sent: true, via: "template", conversation_id: "c", truncated: false })
    const emit = await run(bundle)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toEqual({
      work_order_id: "order_152",
      partner_id: "partner_shramdaan",
      production_run_ids: ["run_a", "run_b", "run_c"],
    })
    expect(emit).not.toHaveBeenCalled()
  })

  it("does not re-send per design when the bundle was already announced", async () => {
    notify.mockResolvedValue({ sent: false, reason: "already_notified" })
    const emit = await run(bundle)
    expect(emit).not.toHaveBeenCalled()
  })

  it("falls back to today's per-design message when the partner has no WhatsApp thread", async () => {
    notify.mockResolvedValue({ sent: false, reason: "no_conversation" })
    const emit = await run(bundle)
    expect(emit).toHaveBeenCalledTimes(1)
    const events = emit.mock.calls[0][0] as any[]
    expect(events.map((e) => e.name)).toEqual([
      "production_run.sent_to_partner",
      "production_run.sent_to_partner",
      "production_run.sent_to_partner",
    ])
    expect(events[1].data).toEqual({
      production_run_id: "run_b",
      partner_id: "partner_shramdaan",
      design_id: "d_b",
      bundle_fallback: true,
      bundle_push_sent: true,
    })
  })

  it("falls back per design when the send throws", async () => {
    notify.mockRejectedValue(new Error("Meta 500"))
    const emit = await run(bundle)
    expect((emit.mock.calls[0][0] as any[]).length).toBe(3)
  })

  it("with no work order, falls back per design AND lets each design push", async () => {
    const emit = await run({ ...bundle, work_order_id: null })
    expect(notify).not.toHaveBeenCalled()
    const events = emit.mock.calls[0][0] as any[]
    expect(events).toHaveLength(3)
    expect(events.every((e) => e.data.bundle_push_sent === false)).toBe(true)
  })

  it("kill switch sends per design, exactly as before #2500", async () => {
    process.env.WORK_ORDER_SENT_WHATSAPP = "false"
    const emit = await run(bundle)
    expect(notify).not.toHaveBeenCalled()
    expect((emit.mock.calls[0][0] as any[]).length).toBe(3)
  })
})
