import {
  APPLIED_AT_KEY,
  planConsumptionApplication,
  resolveLocationsFromLevels,
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
    quantity_basis: "total",
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
        location_id: BRAND,
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
    expect((d as any).reason).toMatch(/not where this design draws stock from/)
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

/**
 * Where a material sits is what decides the deduction. Cases are the real prod
 * shapes from the nine unsettled material logs.
 */
describe("resolveLocationsFromLevels", () => {
  const level = (item: string, loc: string, qty: number | string | null) => ({
    inventory_item_id: item,
    location_id: loc,
    stocked_quantity: qty,
  })

  it("places a material stocked in exactly one location", () => {
    // 5210-MUSLIN-100S: stocked only at Dharamshala.
    expect(
      resolveLocationsFromLevels([level("iitem_muslin", "sloc_dharamshala", 23)])
    ).toEqual({ iitem_muslin: "sloc_dharamshala" })
  })

  it("ignores a zero level, so two levels still resolve to one place", () => {
    // Denim Trouser's FAB-HAN-IND-001: Dharamshala 17.6, Shramdaan 0.
    expect(
      resolveLocationsFromLevels([
        level("iitem_denim", "sloc_dharamshala", 17.6),
        level("iitem_denim", "sloc_shramdaan", 0),
      ])
    ).toEqual({ iitem_denim: "sloc_dharamshala" })
  })

  it("leaves a material stocked nowhere unresolved (partner-held)", () => {
    // Six prod logs look exactly like this — the ownership boundary, for free.
    expect(
      resolveLocationsFromLevels([level("iitem_partner", "sloc_partner", 0)])
    ).toEqual({})
  })

  it("treats a negative level as no stock", () => {
    // Dark Desires Dress sits at -2.5.
    expect(
      resolveLocationsFromLevels([level("iitem_neg", "sloc_partner", -2.5)])
    ).toEqual({})
  })

  it("refuses to guess when two locations both hold stock", () => {
    expect(
      resolveLocationsFromLevels([
        level("iitem_x", "sloc_a", 5),
        level("iitem_x", "sloc_b", 5),
      ])
    ).toEqual({})
  })

  it("ignores stock sitting at a location we do not own", () => {
    // The hazard core-gating exists to close: a partner warehouse holding real
    // stock would otherwise resolve as the place to deduct from.
    expect(
      resolveLocationsFromLevels(
        [level("iitem_x", "sloc_partner", 40)],
        new Set(["sloc_dharamshala"])
      )
    ).toEqual({})
  })

  it("resolves against our locations only, ignoring a partner's stock", () => {
    expect(
      resolveLocationsFromLevels(
        [
          level("iitem_x", "sloc_dharamshala", 12),
          level("iitem_x", "sloc_partner", 40),
        ],
        new Set(["sloc_dharamshala"])
      )
    ).toEqual({ iitem_x: "sloc_dharamshala" })
  })

  it("resolves each material independently", () => {
    expect(
      resolveLocationsFromLevels([
        level("iitem_a", "sloc_dharamshala", 35.6),
        level("iitem_b", "sloc_partner", 0),
        level("iitem_c", "sloc_kashmir", 3),
      ])
    ).toEqual({ iitem_a: "sloc_dharamshala", iitem_c: "sloc_kashmir" })
  })

  it("handles string quantities without treating them as text", () => {
    expect(
      resolveLocationsFromLevels([level("iitem_s", "sloc_a", "17.6")])
    ).toEqual({ iitem_s: "sloc_a" })
  })

  it("ignores malformed rows rather than throwing", () => {
    expect(
      resolveLocationsFromLevels([
        { inventory_item_id: "", location_id: "sloc_a", stocked_quantity: 5 },
        level("iitem_ok", "sloc_a", 5),
      ] as any)
    ).toEqual({ iitem_ok: "sloc_a" })
  })
})

/**
 * The design↔inventory link's "Preferred location" is rendered next to
 * planned/consumed in the admin drawer, implying it decides where the material
 * comes from — while nothing read it and every deduction went to the single
 * brand-store default. These pin it as load-bearing.
 */
describe("per-design Preferred location", () => {
  const BRAND = "sloc_dharamshala"
  const OTHER = "sloc_kashmir"

  const log = (id: string, item = "item_a"): ConsumptionApplyLog => ({
    id,
    design_id: "d1",
    inventory_item_id: item,
    quantity: 2,
    quantity_basis: "total",
    is_committed: true,
    location_id: null,
    metadata: null,
  })

  it("deducts from the design's location instead of the brand default", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1")],
      brandLevels: { item_a: 100 },
      locationByLog: { l1: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 10 },
    })

    expect(d).toMatchObject({
      action: "apply",
      location_id: OTHER,
      before: 10,
      after: 8,
    })
  })

  it("falls back to the brand default when the link sets no location", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1")],
      brandLevels: { item_a: 17.6 },
      locationByLog: {},
    })

    expect(d).toMatchObject({ action: "apply", location_id: BRAND, after: 15.6 })
  })

  it("skips when the item is not stocked at the design's location", () => {
    // The material is ours, but not THERE — absence is still not ownership.
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1")],
      brandLevels: { item_a: 100 },
      locationByLog: { l1: OTHER },
      levelsAtLocation: {},
    })

    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(new RegExp(`no stock level at ${OTHER}`))
  })

  it("accepts a log whose own location matches the design's location", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [{ ...log("l1"), location_id: OTHER }],
      brandLevels: {},
      locationByLog: { l1: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 10 },
    })

    expect(d.action).toBe("apply")
  })

  it("still refuses a log stamped with a partner's warehouse", () => {
    // The whole safety property: a partner-located log must never deduct from
    // our stock just because the design now points somewhere real.
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [{ ...log("l1"), location_id: "sloc_partner" }],
      brandLevels: { item_a: 100 },
      locationByLog: { l1: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 10 },
    })

    expect(d.action).toBe("skip")
  })

  it("refuses a log resolved to a location we do not own", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1")],
      brandLevels: {},
      locationByLog: { l1: "sloc_partner" },
      levelsAtLocation: { "item_a@sloc_partner": 40 },
      coreLocationIds: new Set([BRAND]),
    })

    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/not one of our locations/)
  })

  it("allows any of several locations we own", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1"), log("l2")],
      brandLevels: { item_a: 10 },
      locationByLog: { l2: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 5 },
      coreLocationIds: new Set([BRAND, OTHER]),
    })

    expect(decisions[0]).toMatchObject({ action: "apply", location_id: BRAND })
    expect(decisions[1]).toMatchObject({ action: "apply", location_id: OTHER })
  })

  it("skips when nothing could place the log at all", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "",
      logs: [log("l1")],
      brandLevels: {},
    })

    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/no location could be resolved/)
  })

  it("keeps one item's balance separate across two locations", () => {
    // Keyed by item alone, the second log would read `before: 8` and both
    // levels would end up wrong — this is the double-deduction trap.
    const decisions = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1"), log("l2")],
      brandLevels: { item_a: 10 },
      locationByLog: { l2: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 5 },
    })

    expect(decisions[0]).toMatchObject({ location_id: BRAND, before: 10, after: 8 })
    expect(decisions[1]).toMatchObject({ location_id: OTHER, before: 5, after: 3 })
  })

  it("shares a balance between two logs at the same location", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: BRAND,
      logs: [log("l1"), log("l2")],
      brandLevels: {},
      locationByLog: { l1: OTHER, l2: OTHER },
      levelsAtLocation: { [`item_a@${OTHER}`]: 10 },
    })

    expect(decisions[0]).toMatchObject({ before: 10, after: 8 })
    expect(decisions[1]).toMatchObject({ before: 8, after: 6 })
  })
})

describe("maxShortfall guard", () => {
  const log = (id: string, item: string, quantity: number) => ({
    id,
    design_id: "d1",
    inventory_item_id: item,
    quantity,
    quantity_basis: "total" as const,
    is_committed: true,
    location_id: null,
    metadata: null,
  })

  it("skips rather than stamps a log the level cannot cover", () => {
    // The one-way door: applying floors at 0, records the shortfall, and stamps
    // inventory_applied_at — so a later route repair can never re-apply it.
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 5)],
      brandLevels: { item_a: 0 },
      maxShortfall: 0,
    })
    expect(decisions[0].action).toBe("skip")
    expect((decisions[0] as any).reason).toMatch(/shortfall 5 exceeds max_shortfall 0/)
  })

  it("still applies a deduction fully covered by stock", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2.15)],
      brandLevels: { item_a: 17.6 },
      maxShortfall: 0,
    })
    expect(decisions[0]).toMatchObject({ action: "apply", before: 17.6, after: 15.45 })
  })

  it("allows a shortfall within the tolerance", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 5)],
      brandLevels: { item_a: 4.5 },
      maxShortfall: 1,
    })
    expect(decisions[0]).toMatchObject({ action: "apply", after: 0, shortfall: 0.5 })
  })

  it("keeps prior behaviour when the guard is not set", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 5)],
      brandLevels: { item_a: 0 },
    })
    expect(decisions[0]).toMatchObject({ action: "apply", shortfall: 5 })
  })

  it("does not let a skipped log draw down the running balance", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 99), log("l2", "item_a", 2)],
      brandLevels: { item_a: 10 },
      maxShortfall: 0,
    })
    expect(decisions[0].action).toBe("skip")
    expect(decisions[1]).toMatchObject({ action: "apply", before: 10, after: 8 })
  })
})

describe("per-piece resolution", () => {
  const log = (id: string, item: string, quantity: number) => ({
    id,
    design_id: "d1",
    inventory_item_id: item,
    quantity,
    quantity_basis: "per_piece" as const,
    is_committed: true,
    location_id: null,
    metadata: null,
  })

  it("multiplies the logged rate by finished pieces", () => {
    // Denim Trouser: 2.15 m/piece against 2 finished pieces = 4.3 m, not 2.15.
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2.15)],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
    })
    expect(d).toMatchObject({
      action: "apply",
      per_piece: 2.15,
      pieces: 2,
      quantity: 4.3,
      before: 17.6,
      after: 13.3,
    })
  })

  it("skips when the piece count is unknown rather than deducting face value", () => {
    // Partner-held designs have no completed runs; deducting 2.5 verbatim would
    // be a guess, and stamping it would make the guess permanent.
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2.5)],
      brandLevels: { item_a: 10 },
      piecesByLog: { l1: 0 },
    })
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/piece count unknown/)
  })

  it("skips a log missing from the map entirely", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2.5)],
      brandLevels: { item_a: 10 },
      piecesByLog: {},
    })
    expect(d.action).toBe("skip")
  })

  it("a total-basis log ignores the piece map entirely", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [{ ...log("l1", "item_a", 2.15), quantity_basis: "total" as const }],
      brandLevels: { item_a: 17.6 },
    })
    expect(d).toMatchObject({ action: "apply", quantity: 2.15, after: 15.45 })
    expect((d as any).pieces).toBeUndefined()
  })

  it("draws the running balance down by the RESOLVED total", () => {
    const decisions = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2), log("l2", "item_a", 1)],
      brandLevels: { item_a: 20 },
      piecesByLog: { l1: 3, l2: 4 },
    })
    // 2×3 = 6 → 14, then 1×4 = 4 → 10
    expect(decisions[0]).toMatchObject({ quantity: 6, after: 14 })
    expect(decisions[1]).toMatchObject({ quantity: 4, before: 14, after: 10 })
  })

  it("applies max_shortfall against the RESOLVED total, not the logged rate", () => {
    // 2.15 alone fits inside 3, but 2.15 × 2 does not — the guard must see 4.3.
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", "item_a", 2.15)],
      brandLevels: { item_a: 3 },
      piecesByLog: { l1: 2 },
      maxShortfall: 0,
    })
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/shortfall 1.3 exceeds/)
  })
})

describe("quantity_basis", () => {
  const log = (id: string, quantity: number, basis?: "total" | "per_piece" | null) => ({
    id,
    design_id: "d1",
    inventory_item_id: "item_a",
    quantity,
    quantity_basis: basis ?? null,
    is_committed: true,
    location_id: null,
    metadata: null,
  })

  it("multiplies a per_piece log by its pieces", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", 2.15, "per_piece")],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
    })
    expect(d).toMatchObject({ action: "apply", quantity: 4.3, after: 13.3, pieces: 2 })
  })

  it("deducts a total log verbatim, even with pieces available", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", 2.15, "total")],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
    })
    expect(d).toMatchObject({ action: "apply", quantity: 2.15, after: 15.45 })
    expect((d as any).pieces).toBeUndefined()
  })

  it("refuses to guess a null basis", () => {
    // The 63 legacy prod logs. Reading 2.15 as a total or per-piece differs by
    // the piece count, so the job must be told rather than assume.
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", 2.15)],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
    })
    expect(d.action).toBe("skip")
    expect((d as any).reason).toMatch(/quantity_basis unknown/)
  })

  it("resolves a null basis only against an explicit assumption", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", 2.15)],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
      assumeBasisWhenUnknown: "per_piece",
    })
    expect(d).toMatchObject({ action: "apply", quantity: 4.3 })
  })

  it("lets a recorded basis win over the assumption", () => {
    const [d] = planConsumptionApplication({
      brandLocationId: "sloc_brand",
      logs: [log("l1", 2.15, "total")],
      brandLevels: { item_a: 17.6 },
      piecesByLog: { l1: 2 },
      assumeBasisWhenUnknown: "per_piece",
    })
    expect(d).toMatchObject({ action: "apply", quantity: 2.15 })
  })
})
