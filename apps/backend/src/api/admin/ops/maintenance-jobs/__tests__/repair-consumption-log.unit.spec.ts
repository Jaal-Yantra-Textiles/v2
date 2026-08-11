import {
  planConsumptionLogRepair,
  repairConsumptionLogJob,
} from "../repair-consumption-log-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * #1248 — correcting a consumption log, which nothing could do before.
 *
 * The live case: log 01KXQNH5301PBA9H2BF9ZWWAJJ on "Butterfly in muslin" carries
 * location sloc_01KKTXV7…, but 5210-MUSLIN-100S is stocked only at Dharamshala
 * (sloc_01JPAQVG…). The apply job reads a foreign location as partner-held and
 * skips it, so 4 m never leaves the books.
 */

const DHARAMSHALA = "sloc_01JPAQVGYJR3CDP2Q2AYV7GRDR"
const WRONG_LOC = "sloc_01KKTXV7B3EFCNSAK4WD1JQW7A"

const log = (over: Record<string, any> = {}) => ({
  id: "01KXQNH5301PBA9H2BF9ZWWAJJ",
  design_id: "01KWVA4SB9HRWYE9Z7D5P1MAFP",
  inventory_item_id: "iitem_01K76M7XBNH7K1ER46WAXT7BY6",
  quantity: 4,
  quantity_basis: null,
  location_id: WRONG_LOC,
  is_committed: true,
  metadata: { committed_at: "2026-07-17T09:11:44.151Z" },
  ...over,
})

describe("planConsumptionLogRepair", () => {
  it("moves the log to the location the material is actually stocked at", () => {
    const changes = planConsumptionLogRepair(log(), { location_id: DHARAMSHALA })
    expect(changes).toEqual([
      {
        entity: "consumption_log",
        id: "01KXQNH5301PBA9H2BF9ZWWAJJ",
        field: "location_id",
        before: WRONG_LOC,
        after: DHARAMSHALA,
      },
    ])
  })

  it("corrects several fields at once", () => {
    const changes = planConsumptionLogRepair(log(), {
      location_id: DHARAMSHALA,
      quantity: 2,
      quantity_basis: "per_piece",
    })
    expect(changes.map((c) => c.field)).toEqual([
      "location_id",
      "quantity",
      "quantity_basis",
    ])
  })

  it("emits nothing for a field already at the requested value", () => {
    const changes = planConsumptionLogRepair(log({ location_id: DHARAMSHALA }), {
      location_id: DHARAMSHALA,
    })
    expect(changes).toEqual([])
  })

  it("sets a basis on a legacy log that has none", () => {
    const changes = planConsumptionLogRepair(log(), { quantity_basis: "total" })
    expect(changes[0]).toMatchObject({
      field: "quantity_basis",
      before: null,
      after: "total",
    })
  })

  it("touches only what was asked for", () => {
    const changes = planConsumptionLogRepair(log(), { quantity: 2 })
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe("quantity")
  })
})

const makeContainer = (row: Record<string, any> | null) => {
  const updateConsumptionLogs = jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: () => ({
      retrieveConsumptionLog: jest.fn(async () => {
        if (!row) throw new Error("not found")
        return row
      }),
      updateConsumptionLogs,
    }),
  } as any
  return { container, updateConsumptionLogs }
}

describe("repair-consumption-log — run()", () => {
  it("previews without writing on a dry run", async () => {
    const { container, updateConsumptionLogs } = makeContainer(log())

    const res = await repairConsumptionLogJob.run(container, {
      dry_run: true,
      params: { log_id: log().id, set_location_id: DHARAMSHALA },
    } as any)

    expect(res.applied).toBe(false)
    expect(res.changes).toHaveLength(1)
    expect(updateConsumptionLogs).not.toHaveBeenCalled()
    expect(res.summary).toMatch(/Would correct/)
  })

  it("writes only the corrected fields", async () => {
    const { container, updateConsumptionLogs } = makeContainer(log())

    const res = await repairConsumptionLogJob.run(container, {
      dry_run: false,
      params: { log_id: log().id, set_location_id: DHARAMSHALA, set_quantity: 2 },
    } as any)

    expect(res.applied).toBe(true)
    expect(updateConsumptionLogs).toHaveBeenCalledWith({
      id: log().id,
      location_id: DHARAMSHALA,
      quantity: 2,
    })
  })

  it("refuses a log whose deduction already moved stock", async () => {
    const { container } = makeContainer(
      log({ metadata: { inventory_applied_at: "2026-08-11T09:56:00.000Z" } })
    )

    await expect(
      repairConsumptionLogJob.run(container, {
        dry_run: true,
        params: { log_id: log().id, set_quantity: 2 },
      } as any)
    ).rejects.toThrow(/already applied to inventory/)
  })

  it("refuses a call that asks for no correction at all", async () => {
    const { container } = makeContainer(log())

    await expect(
      repairConsumptionLogJob.run(container, {
        dry_run: true,
        params: { log_id: log().id },
      } as any)
    ).rejects.toThrow(/nothing to correct/)
  })

  it("rejects a non-positive quantity rather than storing it", async () => {
    const { container } = makeContainer(log())

    await expect(
      repairConsumptionLogJob.run(container, {
        dry_run: true,
        params: { log_id: log().id, set_quantity: 0 },
      } as any)
    ).rejects.toThrow()
  })

  it("404s on an unknown log", async () => {
    const { container } = makeContainer(null)

    await expect(
      repairConsumptionLogJob.run(container, {
        dry_run: true,
        params: { log_id: "nope", set_quantity: 2 },
      } as any)
    ).rejects.toThrow(/not found/)
  })

  it("reports a no-op plainly instead of claiming a change", async () => {
    const { container, updateConsumptionLogs } = makeContainer(
      log({ location_id: DHARAMSHALA })
    )

    const res = await repairConsumptionLogJob.run(container, {
      dry_run: false,
      params: { log_id: log().id, set_location_id: DHARAMSHALA },
    } as any)

    expect(res.applied).toBe(false)
    expect(updateConsumptionLogs).not.toHaveBeenCalled()
    expect(res.summary).toMatch(/already holds the requested values/)
  })
})

describe("repair-consumption-log — registry wiring", () => {
  it("is registered and resolvable by id", () => {
    expect(getMaintenanceJob("repair-consumption-log")).toBe(repairConsumptionLogJob)
    expect(MAINTENANCE_JOBS).toContain(repairConsumptionLogJob)
  })
})
