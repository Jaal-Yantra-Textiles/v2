import productionRunEscalationNotifier, {
  config,
} from "../production-run-escalation-notifier"

/**
 * #1279 — this subscriber is the audience `production_run.reminder_escalated`
 * has been naming since #1093 and never had. Before it, the event's only
 * consumer wrote a timeline row labelled "escalated to admin" that nobody read.
 *
 * So the properties worth pinning are about REACHING someone, and about the two
 * escalations staying distinguishable — a parked run needs re-dispatching, a
 * stalled one needs chasing, and telling an admin the wrong one wastes the only
 * message they get.
 */

const RUN = "prod_run_01KMYY7XVR6XVHW39YXMY6CKX0"

const harness = (
  run: Record<string, any> | null = { name: "Dark Desires Dress", quantity: 4 },
  over: { notification?: any } = {}
) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const notification = over.notification ?? { createNotifications: jest.fn() }
  const runService = {
    retrieveProductionRun: jest.fn().mockResolvedValue(run),
  }

  return {
    logger,
    notification,
    runService,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === "notification") return notification
        if (key === "production_runs") return runService
        throw new Error(`unexpected resolve(${key})`)
      },
    } as any,
  }
}

const fire = (h: any, name: string, data: Record<string, any>) =>
  productionRunEscalationNotifier({ event: { name, data }, container: h.container } as any)

describe("production-run-escalation-notifier", () => {
  it("subscribes to BOTH silent rungs, not just the new one", () => {
    expect(config.event).toEqual([
      "production_run.reminder_escalated",
      "production_run.reminder_awaiting_reassignment",
    ])
  })

  it("tells an admin a parked run needs a partner, and how to give it one", async () => {
    const h = harness()
    await fire(h, "production_run.reminder_awaiting_reassignment", {
      production_run_id: RUN,
      parked_days: 135,
      previous_partner_id: "partner_abc",
    })

    const [{ data }] = h.notification.createNotifications.mock.calls[0]
    expect(data.title).toContain("parked")
    expect(data.title).toContain("135d")
    expect(data.description).toContain("Dark Desires Dress")
    expect(data.description).toContain("no partner assigned")
    expect(data.description).toContain("redispatch-parked")
    expect(data.description).toContain("partner_abc")
    // It must say it will come back — an escalation that looks one-shot gets
    // triaged as "I'll deal with it later" and then never resurfaces.
    expect(data.description).toContain("weekly")
  })

  it("does NOT tell an admin to re-dispatch a run whose partner still holds it", async () => {
    const h = harness()
    await fire(h, "production_run.reminder_escalated", { production_run_id: RUN })

    const [{ data }] = h.notification.createNotifications.mock.calls[0]
    expect(data.title).toContain("gone quiet")
    expect(data.description).toContain("still holds the work")
    expect(data.description).not.toContain("redispatch-parked")
  })

  it("falls back to the run id when the run has no name", async () => {
    const h = harness(null)
    await fire(h, "production_run.reminder_awaiting_reassignment", {
      production_run_id: RUN,
    })

    const [{ data }] = h.notification.createNotifications.mock.calls[0]
    expect(data.description).toContain(RUN)
  })

  it("still logs the escalation when the notification provider is down", async () => {
    const h = harness(undefined as any, {
      notification: {
        createNotifications: jest.fn().mockRejectedValue(new Error("provider down")),
      },
    })

    await expect(
      fire(h, "production_run.reminder_awaiting_reassignment", { production_run_id: RUN })
    ).resolves.toBeUndefined()

    // The log line is the fallback record that an escalation happened at all.
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("parked"))
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("provider down"))
  })

  it("ignores an event with no run id instead of throwing", async () => {
    const h = harness()
    await expect(fire(h, "production_run.reminder_escalated", {})).resolves.toBeUndefined()
    expect(h.notification.createNotifications).not.toHaveBeenCalled()
  })

  it("never throws out of the subscriber — a retry would re-escalate", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const container = {
      resolve: (key: string) => {
        if (key === "logger") return logger
        throw new Error("module gone")
      },
    } as any

    await expect(
      productionRunEscalationNotifier({
        event: { name: "production_run.reminder_escalated", data: { production_run_id: RUN } },
        container,
      } as any)
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("module gone"))
  })
})
