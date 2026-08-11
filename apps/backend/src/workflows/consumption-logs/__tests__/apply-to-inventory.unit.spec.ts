import {
  APPLIED_AT_KEY,
  planConsumptionApplication,
  type ConsumptionApplyLog,
} from "../lib/apply-to-inventory"

/**
 * planConsumptionApplication. Pure: no container/DB.
 *
 * The scenario: 63 committed consumption logs on prod moved zero stock.
 * Committing is accounting-only by design — partners burn fabric we never
 * owned — so the fix must deduct ONLY material issued from our own warehouse
 * (the brand store's location), and must not touch the 1300 units of
 * `Hour`/`kWh` labour and energy logs that carry no inventory_item_id.
 */
describe("planConsumptionApplication", () => {
  const BRAND = "sloc_dharamshala"

  const log = (over: Partial<ConsumptionApplyLog> = {}): ConsumptionApplyLog => ({
    id: "log_1",
    design_id: "design_1",
    inventory_item_id: "iitem_denim",
    quantity: 2.15,
    is_committed: true,
    location_id: null,
    metadata: null,
    ...over,
  })

  const plan = (logs: ConsumptionApplyLog[], brandLevels = { iitem_denim: 17.6 }) =>
    planConsumptionApplication({ brandLocationId: BRAND, logs, brandLevels })

  it("deducts a committed log from the brand location", () => {
    expect(plan([log()])).toEqual([
      {
        action: "apply",
        log_id: "log_1",
        inventory_item_id: "iitem_denim",
        quantity: 2.15,
        before: 17.6,
        after: 15.45,
      },
    ])
  })

  it("skips labour/energy logs, which carry no inventory_item_id", () => {
    const [d] = plan([log({ inventory_item_id: null, quantity: 30 })])
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/labour\/energy/)
  })

  it("skips an item with no level at the brand location (partner-held)", () => {
    const [d] = plan([log({ inventory_item_id: "iitem_partner_only" })])
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/partner-held/)
  })

  it("skips a log explicitly located somewhere other than the brand location", () => {
    const [d] = plan([log({ location_id: "sloc_weaver" })])
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/non-brand location/)
  })

  it("applies a log explicitly located AT the brand location", () => {
    const [d] = plan([log({ location_id: BRAND })])
    expect(d.action).toBe("apply")
  })

  it("skips an already-applied log so re-runs never double-deduct", () => {
    const [d] = plan([
      log({ metadata: { [APPLIED_AT_KEY]: "2026-08-11T00:00:00.000Z" } }),
    ])
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/already applied/)
  })

  it("skips uncommitted logs", () => {
    const [d] = plan([log({ is_committed: false })])
    expect(d.action).toBe("skip")
    expect((d as any).reason).toBe("not committed")
  })

  it("carries the balance forward across several logs on one item", () => {
    const decisions = plan([
      log({ id: "log_a", quantity: 10 }),
      log({ id: "log_b", quantity: 5 }),
    ])
    expect(decisions).toEqual([
      expect.objectContaining({ log_id: "log_a", before: 17.6, after: 7.6 }),
      expect.objectContaining({ log_id: "log_b", before: 7.6, after: 2.6 }),
    ])
  })

  it("floors at zero and reports the shortfall instead of going negative", () => {
    const [d] = plan([log({ quantity: 20 })])
    expect(d).toEqual(
      expect.objectContaining({ action: "apply", before: 17.6, after: 0, shortfall: 2.4 })
    )
  })

  it("lands exactly on zero without reporting a shortfall", () => {
    const [d] = plan([log({ quantity: 3 })], { iitem_denim: 3 })
    expect(d).toEqual(expect.objectContaining({ after: 0 }))
    expect((d as any).shortfall).toBeUndefined()
  })

  it("skips non-positive quantities", () => {
    expect(plan([log({ quantity: 0 })])[0].action).toBe("skip")
    expect(plan([log({ quantity: null })])[0].action).toBe("skip")
  })

  it("is deterministic regardless of input order", () => {
    const a = plan([log({ id: "log_b", quantity: 5 }), log({ id: "log_a", quantity: 10 })])
    const b = plan([log({ id: "log_a", quantity: 10 }), log({ id: "log_b", quantity: 5 })])
    expect(a).toEqual(b)
  })
})
