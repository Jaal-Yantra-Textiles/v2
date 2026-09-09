import { EMPTY_COST_CONFIG, loadCostConfig } from "../read-config"
import { PLATFORM_COST_CONFIG_MODULE } from "../index"

/**
 * #1939 — the I/O wrapper's failure modes.
 *
 * Every one of these is a path where a naive implementation returns zeros and
 * prices a garment at nothing. The contract is: never throw, never zero, always
 * an all-null policy the caller can recognise as "no policy".
 */

const rows = [
  {
    id: "pcc_initial",
    effective_from: "2025-01-01T00:00:00Z",
    is_active: true,
    platform_fee_percent: 10,
    custom_design_markup_percent: 20,
    approval_markup_multiplier: 1.4,
  },
]

const containerWith = (service: any) => ({
  resolve: (key: string) => {
    if (key === PLATFORM_COST_CONFIG_MODULE) return service
    throw new Error(`unknown module ${key}`)
  },
})

describe("loadCostConfig", () => {
  it("reads the policy in force through the module", async () => {
    const out = await loadCostConfig(
      containerWith({ listPlatformCostConfigs: async () => rows })
    )
    expect(out.platform_fee_percent).toBe(10)
    expect(out.custom_design_markup_percent).toBe(20)
    expect(out.approval_markup_multiplier).toBe(1.4)
    expect(out.source_config_id).toBe("pcc_initial")
  })

  it("returns an all-null policy when the module is not registered", async () => {
    const container = {
      resolve: () => {
        throw new Error("module not found")
      },
    }
    await expect(loadCostConfig(container)).resolves.toEqual(EMPTY_COST_CONFIG)
  })

  it("returns an all-null policy when the query throws", async () => {
    const out = await loadCostConfig(
      containerWith({
        listPlatformCostConfigs: async () => {
          throw new Error("connection reset")
        },
      })
    )
    expect(out).toEqual(EMPTY_COST_CONFIG)
  })

  it("returns an all-null policy when the table is empty", async () => {
    const out = await loadCostConfig(
      containerWith({ listPlatformCostConfigs: async () => [] })
    )
    expect(out).toEqual(EMPTY_COST_CONFIG)
  })

  it("returns an all-null policy when the service lacks the list method", async () => {
    const out = await loadCostConfig(containerWith({}))
    expect(out).toEqual(EMPTY_COST_CONFIG)
  })

  it("🔴 no failure path ever yields a zero — a zero would price at nothing", async () => {
    const failures = [
      containerWith({}),
      containerWith({ listPlatformCostConfigs: async () => [] }),
      containerWith({
        listPlatformCostConfigs: async () => {
          throw new Error("boom")
        },
      }),
    ]
    for (const c of failures) {
      const out = await loadCostConfig(c)
      // Asserted on values, not with toBeFalsy — `toBeFalsy` passes on 0, which
      // is precisely the value this test exists to forbid.
      expect(Object.values(out)).not.toContain(0)
      expect(out.platform_fee_percent).toBeNull()
      expect(out.approval_markup_multiplier).toBeNull()
    }
  })

  it("honours the `at` moment, not just the latest row", async () => {
    const twoPolicies = [
      { id: "old", effective_from: "2025-01-01T00:00:00Z", is_active: true, custom_design_markup_percent: 20 },
      { id: "new", effective_from: "2026-06-01T00:00:00Z", is_active: true, custom_design_markup_percent: 25 },
    ]
    const service = { listPlatformCostConfigs: async () => twoPolicies }
    const before = await loadCostConfig(containerWith(service), new Date("2026-03-01T00:00:00Z"))
    const after = await loadCostConfig(containerWith(service), new Date("2026-09-01T00:00:00Z"))
    // A design quoted in March stays explicable after the policy moves in June.
    expect(before.custom_design_markup_percent).toBe(20)
    expect(after.custom_design_markup_percent).toBe(25)
  })
})
