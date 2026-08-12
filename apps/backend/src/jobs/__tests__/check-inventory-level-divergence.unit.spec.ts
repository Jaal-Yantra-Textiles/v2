import checkInventoryLevelDivergence, {
  config,
} from "../check-inventory-level-divergence"

/**
 * #1259 — the divergence detector was correct and unrun.
 *
 * The live case: `FAB-TWO-BLU-001` sat at numeric 0 / raw -2.5 from some write
 * before 2026-08-11 and was found only when a human happened to look. By then
 * the workflow-execution history had aged out and the level's pre-correction
 * `updated_at` had been overwritten by the fix, so the writer is now
 * unrecoverable. These tests pin the two properties that decide whether the
 * NEXT one is recoverable: it must fire on its own, and it must never resolve
 * anything by itself.
 */

const logger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
})

const level = (over: Record<string, any> = {}) => ({
  id: "ilev_1",
  inventory_item_id: "iitem_1",
  location_id: "sloc_1",
  stocked_quantity: 5,
  raw_stocked_quantity: { value: "5", precision: 20 },
  ...over,
})

const containerWith = (
  levels: any[],
  over: { notification?: any; log?: any } = {}
) => {
  const log = over.log ?? logger()
  const notification = over.notification ?? { createNotifications: jest.fn() }
  const graph = jest.fn().mockResolvedValue({ data: levels })

  return {
    container: {
      resolve: (key: string) => {
        if (key === "logger") return log
        if (key === "query") return { graph }
        if (key === "notification") return notification
        throw new Error(`unexpected resolve(${key})`)
      },
    } as any,
    log,
    notification,
    graph,
  }
}

describe("check-inventory-level-divergence", () => {
  it("is scheduled — the detector's problem was never accuracy, it was that nothing ran it", () => {
    expect(config.name).toBe("check-inventory-level-divergence")
    expect(config.schedule).toBe("0 5 * * *")
  })

  it("says nothing to the bell when both halves agree and nothing is negative", async () => {
    const { container, log, notification } = containerWith([level(), level({ id: "ilev_2" })])

    await checkInventoryLevelDivergence(container)

    expect(notification.createNotifications).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("compared 2/2")
    )
  })

  it("reports a level whose two stored values disagree, and changes nothing", async () => {
    const { container, log, notification, graph } = containerWith([
      level({
        stocked_quantity: 0,
        raw_stocked_quantity: { value: "-2.5", precision: 20 },
        inventory_item_id: "iitem_blu",
      }),
    ])

    await checkInventoryLevelDivergence(container)

    // query.graph is the ONLY call it makes. No write path exists.
    expect(graph).toHaveBeenCalledTimes(1)

    const [{ data }] = notification.createNotifications.mock.calls[0]
    expect(data.title).toContain("disagree")
    expect(data.description).toContain("numeric=0 raw=-2.5")
    expect(data.description).toContain("Nothing was changed")
    expect(log.warn).toHaveBeenCalled()
  })

  it("reports a negative level without zeroing it — it can be an un-recorded receipt", async () => {
    const { container, notification } = containerWith([
      level({
        stocked_quantity: -4,
        raw_stocked_quantity: { value: "-4", precision: 20 },
      }),
    ])

    await checkInventoryLevelDivergence(container)

    const [{ data }] = notification.createNotifications.mock.calls[0]
    expect(data.title).toContain("Negative inventory level")
    expect(data.description).toContain("record the receipt instead of zeroing it")
  })

  it("warns when it could not compare every row — a partial denominator IS the finding", async () => {
    const { container, log } = containerWith([
      level(),
      level({ id: "ilev_2", raw_stocked_quantity: undefined }),
    ])

    await checkInventoryLevelDivergence(container)

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("compared only 1/2")
    )
  })

  it("calls a 0/N reading INERT rather than clean — a dead check and a healthy one look identical", async () => {
    const { container, log, notification } = containerWith([
      level({ raw_stocked_quantity: undefined }),
      level({ id: "ilev_2", raw_stocked_quantity: undefined }),
    ])

    await checkInventoryLevelDivergence(container)

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("INERT"))
    // Still no bell: nothing is provably wrong. The warn line is the signal.
    expect(notification.createNotifications).not.toHaveBeenCalled()
  })

  it("survives a notification outage — losing the bell must not also lose the log line", async () => {
    const { container, log } = containerWith(
      [
        level({
          stocked_quantity: 0,
          raw_stocked_quantity: { value: "-2.5", precision: 20 },
        }),
      ],
      {
        notification: {
          createNotifications: jest.fn().mockRejectedValue(new Error("provider down")),
        },
      }
    )

    await expect(checkInventoryLevelDivergence(container)).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("disagree"))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("provider down"))
  })

  it("never throws out of the scheduler", async () => {
    const log = logger()
    const container = {
      resolve: (key: string) => {
        if (key === "logger") return log
        throw new Error("query is gone")
      },
    } as any

    await expect(checkInventoryLevelDivergence(container)).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("query is gone"))
  })
})
