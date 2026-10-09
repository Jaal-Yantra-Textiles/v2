jest.mock("../../lib/notifications/create-partner-notification", () => ({
  createPartnerNotification: jest.fn(async () => undefined),
}))

import productionRunActivityRecorder from "../production-run-activity-recorder"
import { createPartnerNotification } from "../../lib/notifications/create-partner-notification"

const run = async (name: string, data: Record<string, any>) => {
  const createProductionRunActivities = jest.fn(async (_row: any) => ({}))
  const container: any = {
    resolve: (key: string) =>
      key === "logger"
        ? { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
        : { createProductionRunActivities },
  }
  await productionRunActivityRecorder({ event: { name, data }, container } as any)
  return createProductionRunActivities.mock.calls[0]?.[0] as any
}

describe("productionRunActivityRecorder — reminder cap retry (2026-10-09)", () => {
  it("does not claim a message was re-sent: the retry only restarts the count", async () => {
    const row = await run("production_run.reminder_retried_same_partner", {
      production_run_id: "prod_run_x",
      partner_id: "partner_x",
      reminder_kind: "assignment_pending",
    })
    expect(row.activity_type).toBe("lifecycle_event")
    expect(row.kind).toBe("reminder_retried_same_partner")
    expect(row.summary).not.toMatch(/re-sent/i)
    expect(row.summary).toMatch(/nothing sent/i)
    expect(row.channel).toBeNull()
    // Not a send, so the partner's bell/push is not touched either.
    expect(createPartnerNotification).not.toHaveBeenCalled()
  })
})
