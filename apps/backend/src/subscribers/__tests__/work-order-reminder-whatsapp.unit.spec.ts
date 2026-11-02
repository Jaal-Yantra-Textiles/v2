jest.mock("../../workflows/designs/lib/notify-partner-of-work-order", () => ({
  remindPartnerOfWorkOrder: jest.fn(),
}))
jest.mock("../../lib/notifications/create-partner-notification", () => ({
  createPartnerNotification: jest.fn(async () => undefined),
}))

import workOrderReminderWhatsapp from "../work-order-reminder-whatsapp"
import { remindPartnerOfWorkOrder } from "../../workflows/designs/lib/notify-partner-of-work-order"
import { createPartnerNotification } from "../../lib/notifications/create-partner-notification"

const remind = remindPartnerOfWorkOrder as jest.Mock
const push = createPartnerNotification as jest.Mock

const makeContainer = () => {
  const emit = jest.fn(async (_e: any) => undefined)
  const container: any = {
    resolve: (key: string) =>
      key === "logger" ? { error: jest.fn(), warn: jest.fn(), info: jest.fn() } : { emit },
  }
  return { container, emit }
}

const reminderOf = (runId: string) => ({
  name: "production_run.reminder_in_bundle",
  data: {
    production_run_id: runId,
    partner_id: "partner_shramdaan",
    design_id: `d_${runId}`,
    reminder_kind: "assignment_pending",
    reminder_count: 1,
    work_order_id: "order_152",
  },
})

describe("workOrderReminderWhatsapp (#2500)", () => {
  beforeEach(() => {
    remind.mockReset()
    push.mockClear()
    delete process.env.WORK_ORDER_REMINDER_WHATSAPP
  })

  it("a bundle's reminders send ONE message: the first sends, the rest find it sent", async () => {
    let sent = false
    let sends = 0
    remind.mockImplementation(async () => {
      if (sent) return { sent: false, reason: "already_notified" }
      // A slow send: the next reminders arrive while this one is in flight.
      sends++
      await new Promise((r) => setTimeout(r, 20))
      sent = true
      return { sent: true, via: "text", conversation_id: "c", truncated: false, work_order_id: "order_152", listed: 3 }
    })
    const { container, emit } = makeContainer()
    await Promise.all(
      ["run_a", "run_b", "run_c"].map((id) =>
        workOrderReminderWhatsapp({ event: reminderOf(id), container } as any)
      )
    )
    expect(remind).toHaveBeenCalledTimes(3)
    expect(sends).toBe(1)
    expect(emit).not.toHaveBeenCalled()
  })

  it("pushes with one key per bundle, kind and day", async () => {
    remind.mockResolvedValue({ sent: false, reason: "already_notified" })
    const { container } = makeContainer()
    await workOrderReminderWhatsapp({ event: reminderOf("run_a"), container } as any)
    await workOrderReminderWhatsapp({ event: reminderOf("run_b"), container } as any)
    const keys = push.mock.calls.map((c) => c[1].idempotency_key)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toMatch(/^reminder:order_152:assignment_pending:\d{4}-\d{2}-\d{2}:partner_shramdaan$/)
    expect(push.mock.calls[0][1].url).toBe("/orders/order_152")
  })

  it("falls back to this design's own reminder when the bundle message cannot go out", async () => {
    remind.mockResolvedValue({ sent: false, reason: "no_conversation" })
    const { container, emit } = makeContainer()
    await workOrderReminderWhatsapp({ event: reminderOf("run_b"), container } as any)
    expect(emit).toHaveBeenCalledWith({
      name: "production_run.reminder_assignment_pending",
      data: {
        production_run_id: "run_b",
        partner_id: "partner_shramdaan",
        design_id: "d_run_b",
        reminder_kind: "assignment_pending",
        reminder_count: 1,
        bundle_fallback: true,
      },
    })
  })

  it("kill switch reminds each design on its own", async () => {
    process.env.WORK_ORDER_REMINDER_WHATSAPP = "false"
    const { container, emit } = makeContainer()
    await workOrderReminderWhatsapp({ event: reminderOf("run_a"), container } as any)
    expect(remind).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0].name).toBe("production_run.reminder_assignment_pending")
  })
})
