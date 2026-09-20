import { notifyDispatchByHand } from "../lib/notify-dispatch-by-hand"

/*
 * #2202 — the telling.
 *
 * A run whose cloth has arrived and whose templates nobody chose is READY and
 * going nowhere. That state produced one `logger.info` and no other trace, and
 * four runs sat in it until a person happened to ask.
 */

const notificationService = { createNotifications: jest.fn() }
const container = {
  resolve: (key: string) => {
    if (key === "notification") return notificationService
    throw new Error(`unexpected module ${key}`)
  },
}

beforeEach(() => {
  notificationService.createNotifications.mockReset()
  notificationService.createNotifications.mockResolvedValue({ id: "noti_1" })
})

describe("notifyDispatchByHand", () => {
  it("raises an admin-feed notice naming the run and what released it", async () => {
    const ok = await notifyDispatchByHand(container, {
      runId: "prod_run_oshen",
      releasedBy: "inv_order_gof",
      releasedByKind: "inventory order",
    })

    expect(ok).toBe(true)
    /*
     * Asserted on mock.calls AFTER the await, never inside the mock — an
     * expect() thrown inside a mock that the code under test wraps in try/catch
     * is swallowed, and the test passes while proving nothing.
     */
    const [arg] = notificationService.createNotifications.mock.calls[0]
    expect(arg.channel).toBe("feed")
    expect(arg.template).toBe("admin-ui")
    expect(arg.data.description).toContain("prod_run_oshen")
    expect(arg.data.description).toContain("inv_order_gof")
    expect(arg.data.metadata).toMatchObject({
      production_run_id: "prod_run_oshen",
      released_by: "inv_order_gof",
      released_by_kind: "inventory order",
      reason: "no_templates",
    })
  })

  it("says it is READY rather than failed — nothing is broken, work just cannot start", async () => {
    await notifyDispatchByHand(container, {
      runId: "r1",
      releasedBy: "inv_1",
      releasedByKind: "inventory order",
    })
    const [arg] = notificationService.createNotifications.mock.calls[0]
    expect(arg.data.title.toLowerCase()).toContain("ready")
    expect(arg.data.metadata.severity).toBe("warning")
    // Names both ways out, so the reader is not left to invent one.
    expect(arg.data.description).toContain("Dispatch it from the admin")
    expect(arg.data.description).toContain("dispatch-defaults")
  })

  it("distinguishes a run released by another RUN from one released by an order", async () => {
    await notifyDispatchByHand(container, {
      runId: "r2",
      releasedBy: "prod_run_upstream",
      releasedByKind: "production run",
    })
    const [arg] = notificationService.createNotifications.mock.calls[0]
    expect(arg.data.description).toContain("production run prod_run_upstream")
    expect(arg.data.metadata.released_by_kind).toBe("production run")
  })

  it("🔴 never throws when the notification module is down, and says so", async () => {
    /*
     * This runs inside an event-bus handler, after a delivery has been recorded
     * and dependent runs released. A notifier that throws would make all of
     * that look like it failed.
     */
    const warn = jest.fn()
    const broken = {
      resolve: () => {
        throw new Error("notification module down")
      },
    }

    const ok = await notifyDispatchByHand(
      broken,
      { runId: "r3", releasedBy: "inv_2", releasedByKind: "inventory order" },
      { warn }
    )

    expect(ok).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("r3"))
  })

  it("never throws when createNotifications itself rejects", async () => {
    notificationService.createNotifications.mockRejectedValueOnce(
      new Error("feed unavailable")
    )
    const warn = jest.fn()

    await expect(
      notifyDispatchByHand(
        container,
        { runId: "r4", releasedBy: "inv_3", releasedByKind: "inventory order" },
        { warn }
      )
    ).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feed unavailable"))
  })

  it("survives having no logger at all", async () => {
    const broken = {
      resolve: () => {
        throw new Error("down")
      },
    }
    await expect(
      notifyDispatchByHand(broken, {
        runId: "r5",
        releasedBy: "inv_4",
        releasedByKind: "inventory order",
      })
    ).resolves.toBe(false)
  })
})
