import {
  buildEnergyRateMap,
  computeEnergyCost,
  computeLaborCost,
  computePruneCutoff,
  diffCostFields,
  diffEnergyCostFields,
  diffOrderCurrency,
  diffRunCostFields,
  diffUnitCost,
  getMaintenanceJob,
  interpretRunCost,
  MAINTENANCE_JOBS,
  MAX_AUDIT_PRUNE,
  MAX_BULK_DESIGNS,
  MAX_DESIGN_SCAN,
  MAX_INVENTORY_SCAN,
  MAX_ORDER_CURRENCY_SCAN,
  parseDesignIds,
  pickLatestOrderLinePrice,
  round2,
  summarizeAuditPrune,
  summarizeBulkRecalc,
  summarizeEnergyBackfill,
  summarizeOrderCurrencyBackfill,
  summarizeUnitCostBackfill,
} from "../registry"

// Pure unit coverage for the maintenance-job registry (#457). No DB / workflow
// boot — only the dry-run/apply diff logic and registry lookup.
describe("ops/maintenance-jobs registry (#457)", () => {
  describe("getMaintenanceJob", () => {
    it("resolves a registered job by id", () => {
      const job = getMaintenanceJob("recalculate-design-cost")
      expect(job).toBeDefined()
      expect(job?.id).toBe("recalculate-design-cost")
      expect(job?.params.some((p) => p.name === "design_id" && p.required)).toBe(true)
    })

    it("returns undefined for an unknown job", () => {
      expect(getMaintenanceJob("does-not-exist")).toBeUndefined()
    })

    it("exposes at least the recalculate-design-cost job", () => {
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("recalculate-design-cost")
    })

    it("registers the bulk recalculate job with a required design_ids param", () => {
      const job = getMaintenanceJob("recalculate-design-cost-bulk")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "design_ids" && p.required)).toBe(true)
    })

    it("registers the correct-production-run-cost job with a required run id param", () => {
      const job = getMaintenanceJob("correct-production-run-cost")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "production_run_id" && p.required)).toBe(true)
      // cost fields are optional (caller supplies at least one)
      expect(job?.params.some((p) => p.name === "partner_cost_estimate" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "cost_type" && !p.required)).toBe(true)
    })
  })

  describe("interpretRunCost (#456 per-unit × qty trap)", () => {
    it("expands a per_unit estimate to its total over the run quantity", () => {
      expect(interpretRunCost(7650, "per_unit", 9)).toEqual({ per_unit: 7650, total: 68850 })
    })

    it("divides a total estimate down to per-unit over the run quantity", () => {
      expect(interpretRunCost(68850, "total", 9)).toEqual({ per_unit: 7650, total: 68850 })
    })

    it("defaults to 'total' interpretation when cost_type is null/undefined", () => {
      expect(interpretRunCost(100, null, 4)).toEqual({ per_unit: 25, total: 100 })
      expect(interpretRunCost(100, undefined, 4)).toEqual({ per_unit: 25, total: 100 })
    })

    it("treats a non-positive quantity as 1 (no divide-by-zero)", () => {
      expect(interpretRunCost(100, "total", 0)).toEqual({ per_unit: 100, total: 100 })
      expect(interpretRunCost(100, "per_unit", 0)).toEqual({ per_unit: 100, total: 100 })
    })

    it("returns nulls when no estimate is set", () => {
      expect(interpretRunCost(null, "total", 9)).toEqual({ per_unit: null, total: null })
      expect(interpretRunCost(undefined, "per_unit", 9)).toEqual({ per_unit: null, total: null })
    })
  })

  describe("diffRunCostFields", () => {
    it("only considers fields the caller supplied (omitted = untouched)", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { cost_type: "per_unit" }
      )
      expect(changes).toEqual([
        { entity: "production_run", id: "prod_run_1", field: "cost_type", before: "total", after: "per_unit" },
      ])
    })

    it("reports a change for both fields when corrected together", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 68850, cost_type: "total" },
        { partner_cost_estimate: 7650, cost_type: "per_unit" }
      )
      expect(changes).toEqual(
        expect.arrayContaining([
          { entity: "production_run", id: "prod_run_1", field: "partner_cost_estimate", before: 68850, after: 7650 },
          { entity: "production_run", id: "prod_run_1", field: "cost_type", before: "total", after: "per_unit" },
        ])
      )
      expect(changes).toHaveLength(2)
    })

    it("returns no changes when the requested values already match (idempotent)", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { partner_cost_estimate: 100, cost_type: "total" }
      )
      expect(changes).toEqual([])
    })

    it("treats null as a real 'clear the estimate' change, distinct from omitted", () => {
      const cleared = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: 100, cost_type: "total" },
        { partner_cost_estimate: null }
      )
      expect(cleared).toEqual([
        { entity: "production_run", id: "prod_run_1", field: "partner_cost_estimate", before: 100, after: null },
      ])
    })

    it("coerces string-typed persisted decimals before comparing", () => {
      const changes = diffRunCostFields(
        "prod_run_1",
        { partner_cost_estimate: "100" as any, cost_type: "total" },
        { partner_cost_estimate: 100 }
      )
      expect(changes).toEqual([])
    })
  })

  describe("parseDesignIds", () => {
    it("accepts an array of ids", () => {
      expect(parseDesignIds(["d_1", "d_2"])).toEqual(["d_1", "d_2"])
    })

    it("accepts a comma/whitespace/newline-separated string", () => {
      expect(parseDesignIds("d_1, d_2\nd_3  d_4")).toEqual(["d_1", "d_2", "d_3", "d_4"])
    })

    it("trims, drops blanks, and de-duplicates while preserving order", () => {
      expect(parseDesignIds([" d_1 ", "d_2", "", "d_1"])).toEqual(["d_1", "d_2"])
    })

    it("throws INVALID_DATA when no usable id is present", () => {
      expect(() => parseDesignIds("  ,  ")).toThrow(/at least one/)
      expect(() => parseDesignIds([])).toThrow(/at least one/)
    })

    it("throws INVALID_DATA for a non-string/array input", () => {
      expect(() => parseDesignIds(undefined)).toThrow(/required/)
      expect(() => parseDesignIds(42 as any)).toThrow(/required/)
    })

    it("rejects more ids than the per-request cap", () => {
      const tooMany = Array.from({ length: MAX_BULK_DESIGNS + 1 }, (_, i) => `d_${i}`)
      expect(() => parseDesignIds(tooMany)).toThrow(/limit of/)
    })

    it("allows exactly the cap", () => {
      const atCap = Array.from({ length: MAX_BULK_DESIGNS }, (_, i) => `d_${i}`)
      expect(parseDesignIds(atCap)).toHaveLength(MAX_BULK_DESIGNS)
    })
  })

  describe("summarizeBulkRecalc", () => {
    it("reports no changes when nothing drifted", () => {
      expect(summarizeBulkRecalc(true, 3, 0, 0, 0)).toMatch(/No changes — 3 design/)
    })

    it("uses 'Would update' for dry-run and counts changed designs", () => {
      expect(summarizeBulkRecalc(true, 5, 2, 4, 0)).toBe(
        "Would update 4 field(s) across 2/5 design(s)"
      )
    })

    it("uses 'Updated' on apply and appends an error count when present", () => {
      expect(summarizeBulkRecalc(false, 5, 2, 4, 1)).toBe(
        "Updated 4 field(s) across 2/5 design(s); 1 error(s)"
      )
    })
  })

  describe("diffCostFields", () => {
    const after = { total_estimated: 100, material_cost: 70, production_cost: 30 }

    it("reports a change for every field when nothing is persisted yet (null → value)", () => {
      const changes = diffCostFields("design_1", {}, after)
      expect(changes).toHaveLength(3)
      expect(changes).toEqual(
        expect.arrayContaining([
          { entity: "design", id: "design_1", field: "estimated_cost", before: null, after: 100 },
          { entity: "design", id: "design_1", field: "material_cost", before: null, after: 70 },
          { entity: "design", id: "design_1", field: "production_cost", before: null, after: 30 },
        ])
      )
    })

    it("returns no changes when persisted values already match (idempotent apply)", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 70, production_cost: 30 },
        after
      )
      expect(changes).toEqual([])
    })

    it("only reports the fields that actually differ", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 60, production_cost: 30 },
        after
      )
      expect(changes).toEqual([
        { entity: "design", id: "design_1", field: "material_cost", before: 60, after: 70 },
      ])
    })

    it("coerces string-typed persisted decimals before comparing", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: "100" as any, material_cost: "70" as any, production_cost: "30" as any },
        after
      )
      expect(changes).toEqual([])
    })

    it("treats null and 0 as distinct (null is unset, 0 is a real value)", () => {
      const changes = diffCostFields(
        "design_1",
        { estimated_cost: 100, material_cost: 70, production_cost: null },
        after
      )
      expect(changes).toEqual([
        { entity: "design", id: "design_1", field: "production_cost", before: null, after: 30 },
      ])
    })
  })

  // ---- backfill-inventory-unit-cost job (#457) ----

  describe("backfill-inventory-unit-cost registration", () => {
    it("registers the job with optional force + limit params", () => {
      const job = getMaintenanceJob("backfill-inventory-unit-cost")
      expect(job).toBeDefined()
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("backfill-inventory-unit-cost")
      expect(job?.params.some((p) => p.name === "force" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "limit" && !p.required)).toBe(true)
    })
  })

  describe("pickLatestOrderLinePrice", () => {
    const line = (price: any, status: string, order_date: string | null, id = "io_1") => ({
      inventory_order_line: {
        id: "iol",
        price,
        inventory_orders: { id, order_date, status },
      },
    })

    it("returns null for no links / no usable price", () => {
      expect(pickLatestOrderLinePrice([])).toBeNull()
      expect(pickLatestOrderLinePrice([{ inventory_order_line: null }])).toBeNull()
    })

    it("ignores cancelled orders and non-positive prices", () => {
      expect(
        pickLatestOrderLinePrice([
          line(50, "Cancelled", "2026-01-01"),
          line(0, "Completed", "2026-01-02"),
          line(-5, "Completed", "2026-01-03"),
        ])
      ).toBeNull()
    })

    it("picks the most recent non-cancelled order line by order_date", () => {
      const picked = pickLatestOrderLinePrice([
        line(10, "Completed", "2026-01-01", "io_old"),
        line(25, "Completed", "2026-03-01", "io_new"),
        line(99, "Cancelled", "2026-06-01", "io_cxl"),
      ])
      expect(picked).toMatchObject({ price: 25, order_id: "io_new" })
      expect(picked?.order_date).toMatch(/^2026-03-01/)
    })

    it("coerces string prices and tolerates a missing order_date", () => {
      const picked = pickLatestOrderLinePrice([line("42.5" as any, "Completed", null)])
      expect(picked?.price).toBe(42.5)
      expect(picked?.order_date).toBeNull()
    })
  })

  describe("diffUnitCost", () => {
    it("reports a change when unit_cost is unset (null → value)", () => {
      expect(diffUnitCost("rm_1", null, 12)).toEqual([
        { entity: "raw_material", id: "rm_1", field: "unit_cost", before: null, after: 12 },
      ])
    })

    it("returns no change when the value already matches (idempotent)", () => {
      expect(diffUnitCost("rm_1", 12, 12)).toEqual([])
      expect(diffUnitCost("rm_1", "12" as any, 12)).toEqual([])
    })

    it("reports the before→after when the price differs", () => {
      expect(diffUnitCost("rm_1", 8, 12)).toEqual([
        { entity: "raw_material", id: "rm_1", field: "unit_cost", before: 8, after: 12 },
      ])
    })
  })

  describe("summarizeUnitCostBackfill", () => {
    it("reports no changes and keeps the scan count", () => {
      expect(summarizeUnitCostBackfill(true, 7, 0, 0, 0, 0)).toMatch(
        /No changes — scanned 7 inventory item/
      )
    })

    it("uses 'Would set' for dry-run and appends skip breakdown", () => {
      expect(summarizeUnitCostBackfill(true, 10, 3, 2, 1, 0)).toBe(
        "Would set unit_cost on 3 raw material(s) (scanned 10 inventory item(s)); 2 unlinked, 1 no order history"
      )
    })

    it("uses 'Set' on apply and appends an error count when present", () => {
      expect(summarizeUnitCostBackfill(false, 10, 3, 0, 0, 1)).toBe(
        "Set unit_cost on 3 raw material(s) (scanned 10 inventory item(s)); 1 error(s)"
      )
    })

    it("exposes a sane scan cap", () => {
      expect(MAX_INVENTORY_SCAN).toBeGreaterThanOrEqual(1000)
    })
  })

  // ---- backfill-design-energy-costs job (#457) ----

  describe("backfill-design-energy-costs registration", () => {
    it("registers the job with optional design_id + force + limit params", () => {
      const job = getMaintenanceJob("backfill-design-energy-costs")
      expect(job).toBeDefined()
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("backfill-design-energy-costs")
      expect(job?.params.some((p) => p.name === "design_id" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "force" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "limit" && !p.required)).toBe(true)
    })

    it("exposes a sane design-scan cap", () => {
      expect(MAX_DESIGN_SCAN).toBeGreaterThanOrEqual(1000)
    })
  })

  describe("round2", () => {
    it("rounds to two decimal places", () => {
      expect(round2(1.005)).toBeCloseTo(1.0) // float quirk: rounds toward 1.00
      expect(round2(2.345)).toBe(2.35)
      expect(round2(10)).toBe(10)
    })
  })

  describe("buildEnergyRateMap", () => {
    it("keeps the most-recently effective rate per energy_type", () => {
      const map = buildEnergyRateMap([
        { energy_type: "energy_electricity", rate_per_unit: 5, effective_from: "2026-01-01" },
        { energy_type: "energy_electricity", rate_per_unit: 8, effective_from: "2026-03-01" },
        { energy_type: "labor", rate_per_unit: 20, effective_from: "2026-01-01" },
      ])
      expect(map.get("energy_electricity")?.rate_per_unit).toBe(8)
      expect(map.get("labor")?.rate_per_unit).toBe(20)
    })

    it("coerces string rates and ignores rows with no energy_type", () => {
      const map = buildEnergyRateMap([
        { energy_type: "energy_water", rate_per_unit: "3.5" as any, effective_from: "2026-01-01" },
        { rate_per_unit: 99 } as any,
      ])
      expect(map.get("energy_water")?.rate_per_unit).toBe(3.5)
      expect(map.size).toBe(1)
    })
  })

  describe("computeEnergyCost", () => {
    const rates = buildEnergyRateMap([
      { energy_type: "energy_electricity", rate_per_unit: 10, effective_from: "2026-01-01" },
    ])

    it("uses the log unit_cost when present (partner_input)", () => {
      const { total, items } = computeEnergyCost(
        [{ consumption_type: "energy_electricity", quantity: 2, unit_cost: 7 }],
        rates
      )
      expect(total).toBe(14)
      expect(items[0].cost_source).toBe("partner_input")
    })

    it("falls back to the active rate when no unit_cost (energy_rate)", () => {
      const { total, items } = computeEnergyCost(
        [{ consumption_type: "energy_electricity", quantity: 3 }],
        rates
      )
      expect(total).toBe(30)
      expect(items[0].cost_source).toBe("energy_rate")
    })

    it("marks cost_source none when no rate is available", () => {
      const { total, items } = computeEnergyCost(
        [{ consumption_type: "energy_gas", quantity: 5 }],
        rates
      )
      expect(total).toBe(0)
      expect(items[0].cost_source).toBe("none")
    })
  })

  describe("computeLaborCost", () => {
    const rates = buildEnergyRateMap([
      { energy_type: "labor", rate_per_unit: 15, effective_from: "2026-01-01" },
    ])

    it("totals labor hours and prices from the labor rate fallback", () => {
      const { total, hours } = computeLaborCost(
        [{ consumption_type: "labor", quantity: 2 }, { consumption_type: "labor", quantity: 3, unit_cost: 20 }],
        rates
      )
      expect(hours).toBe(5)
      expect(total).toBe(2 * 15 + 3 * 20)
    })

    it("returns zeroes for no logs", () => {
      expect(computeLaborCost([], rates)).toEqual({ total: 0, hours: 0 })
    })
  })

  describe("diffEnergyCostFields", () => {
    const after = {
      estimated_cost: 100,
      material_cost: 60,
      production_cost: 20,
      energy_cost_total: 20,
    }

    it("reports a change for every field when nothing is persisted (null → value)", () => {
      const changes = diffEnergyCostFields("d_1", {}, after)
      expect(changes).toHaveLength(4)
      expect(changes).toEqual(
        expect.arrayContaining([
          { entity: "design", id: "d_1", field: "energy_cost_total", before: null, after: 20 },
        ])
      )
    })

    it("is idempotent when persisted values already match", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { estimated_cost: 100, material_cost: 60, production_cost: 20, energy_cost_total: 20 },
          after
        )
      ).toEqual([])
    })

    it("coerces string-typed decimals before comparing", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          {
            estimated_cost: "100" as any,
            material_cost: "60" as any,
            production_cost: "20" as any,
            energy_cost_total: "20" as any,
          },
          after
        )
      ).toEqual([])
    })

    it("only reports the energy_cost_total when that's the sole drift", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { estimated_cost: 100, material_cost: 60, production_cost: 20, energy_cost_total: 5 },
          after
        )
      ).toEqual([
        { entity: "design", id: "d_1", field: "energy_cost_total", before: 5, after: 20 },
      ])
    })
  })

  describe("summarizeEnergyBackfill", () => {
    it("reports no changes and keeps the scan count", () => {
      expect(summarizeEnergyBackfill(true, 7, 0, 0, 0, 0)).toMatch(
        /No changes — scanned 7 design/
      )
    })

    it("uses 'Would update' for dry-run and appends skip breakdown", () => {
      expect(summarizeEnergyBackfill(true, 10, 3, 2, 1, 0)).toBe(
        "Would update cost on 3 design(s) (scanned 10); 2 already had energy costs, 1 no energy/labor logs"
      )
    })

    it("uses 'Updated' on apply and appends an error count when present", () => {
      expect(summarizeEnergyBackfill(false, 10, 3, 0, 0, 1)).toBe(
        "Updated cost on 3 design(s) (scanned 10); 1 error(s)"
      )
    })
  })

  // #483 follow-up: a labor-only design has no energy logs (energyCost → 0), but
  // the apply payload persists energy_cost_total as `undefined` when it's 0, so
  // it reads back as null. Without the 0≡null coercion the diff would report
  // null→0 forever, re-writing the design on every sweep.
  describe("diffEnergyCostFields — energy_cost_total 0≡null idempotency (#483)", () => {
    const base = { estimated_cost: 100, material_cost: 60, production_cost: 40 }

    it("does not report a phantom change when before is null and after is 0", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { ...base, energy_cost_total: null },
          { ...base, energy_cost_total: 0 }
        )
      ).toEqual([])
    })

    it("does not report a phantom change when before is 0 and after is 0", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { ...base, energy_cost_total: 0 },
          { ...base, energy_cost_total: 0 }
        )
      ).toEqual([])
    })

    it("still reports a real energy_cost_total change (e.g. 5 → 0)", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { ...base, energy_cost_total: 5 },
          { ...base, energy_cost_total: 0 }
        )
      ).toEqual([
        { entity: "design", id: "d_1", field: "energy_cost_total", before: 5, after: 0 },
      ])
    })

    it("still reports a real energy_cost_total change (null → 12)", () => {
      expect(
        diffEnergyCostFields(
          "d_1",
          { ...base, energy_cost_total: null },
          { ...base, energy_cost_total: 12 }
        )
      ).toEqual([
        { entity: "design", id: "d_1", field: "energy_cost_total", before: null, after: 12 },
      ])
    })
  })

  describe("prune-ops-audit-runs registry (#457 retention)", () => {
    it("registers the prune job with a required older_than_days param", () => {
      const job = getMaintenanceJob("prune-ops-audit-runs")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "older_than_days" && p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "include_applied" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "limit" && !p.required)).toBe(true)
    })

    it("is included in the registry list", () => {
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("prune-ops-audit-runs")
    })
  })

  describe("computePruneCutoff", () => {
    it("subtracts whole days from now", () => {
      const now = new Date("2026-06-18T00:00:00.000Z")
      expect(computePruneCutoff(now, 30).toISOString()).toBe("2026-05-19T00:00:00.000Z")
    })

    it("subtracts a single day", () => {
      const now = new Date("2026-06-18T12:00:00.000Z")
      expect(computePruneCutoff(now, 1).toISOString()).toBe("2026-06-17T12:00:00.000Z")
    })
  })

  describe("summarizeAuditPrune", () => {
    it("reports no matches with the scope and day window", () => {
      expect(summarizeAuditPrune(true, 0, 30, false)).toBe(
        "No changes — no dry-run-only audit rows older than 30 day(s)"
      )
    })

    it("uses 'Would prune' for dry-run", () => {
      expect(summarizeAuditPrune(true, 4, 30, false)).toBe(
        "Would prune 4 dry-run-only audit row(s) older than 30 day(s)"
      )
    })

    it("uses 'Pruned' on apply and widens the scope when include_applied", () => {
      expect(summarizeAuditPrune(false, 7, 90, true)).toBe(
        "Pruned 7 dry-run + applied audit row(s) older than 90 day(s)"
      )
    })

    it("exposes a sane prune cap", () => {
      expect(MAX_AUDIT_PRUNE).toBeGreaterThanOrEqual(1000)
    })
  })

  describe("backfill-partner-order-currency registry (#485)", () => {
    it("registers the job with optional partner_id / from_currency / limit params", () => {
      const job = getMaintenanceJob("backfill-partner-order-currency")
      expect(job).toBeDefined()
      expect(job?.params.some((p) => p.name === "partner_id" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "from_currency" && !p.required)).toBe(true)
      expect(job?.params.some((p) => p.name === "limit" && !p.required)).toBe(true)
    })

    it("is included in the registry list", () => {
      expect(MAINTENANCE_JOBS.map((j) => j.id)).toContain("backfill-partner-order-currency")
    })

    it("exposes a sane scan cap", () => {
      expect(MAX_ORDER_CURRENCY_SCAN).toBeGreaterThanOrEqual(1000)
    })
  })

  describe("diffOrderCurrency", () => {
    it("returns a single currency_code change when the order is mis-denominated", () => {
      expect(diffOrderCurrency("order_1", "eur", "inr")).toEqual([
        { entity: "order", id: "order_1", field: "currency_code", before: "eur", after: "inr" },
      ])
    })

    it("returns no change when already in the target currency (case-insensitive)", () => {
      expect(diffOrderCurrency("order_1", "INR", "inr")).toEqual([])
    })

    it("normalizes a null before to a real change", () => {
      expect(diffOrderCurrency("order_1", null, "inr")).toEqual([
        { entity: "order", id: "order_1", field: "currency_code", before: null, after: "inr" },
      ])
    })

    it("lower-cases both sides before comparing and emitting", () => {
      expect(diffOrderCurrency("order_1", "EUR", "INR")).toEqual([
        { entity: "order", id: "order_1", field: "currency_code", before: "eur", after: "inr" },
      ])
    })
  })

  describe("summarizeOrderCurrencyBackfill", () => {
    it("reports no matches with partner + order counts", () => {
      expect(summarizeOrderCurrencyBackfill(true, 3, 12, 0, "eur", 0)).toBe(
        "No changes — scanned 12 order(s) across 3 partner(s), none denominated in 'eur' needed correction"
      )
    })

    it("uses 'Would re-stamp' for dry-run", () => {
      expect(summarizeOrderCurrencyBackfill(true, 2, 5, 4, "eur", 0)).toBe(
        "Would re-stamp currency on 4 order(s) (scanned 5 across 2 partner(s), from 'eur')"
      )
    })

    it("uses 'Re-stamped' on apply and appends error count", () => {
      expect(summarizeOrderCurrencyBackfill(false, 2, 5, 4, "eur", 1)).toBe(
        "Re-stamped currency on 4 order(s) (scanned 5 across 2 partner(s), from 'eur'); 1 error(s)"
      )
    })
  })
})
