/**
 * Unit tests for estimate-design-cost workflow pure helpers.
 *
 * We import `computeCostBreakdown` and `resolveItemCost` directly — no Medusa
 * workflow runtime needed, no mocking of @medusajs/framework/workflows-sdk.
 */

// Mock the Medusa SDK so the module-level createStep/createWorkflow calls
// at the top of the workflow file don't throw at import time.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, fn: Function) => fn,
  createWorkflow: (_name: string, fn: Function) => fn,
  StepResponse: class { constructor(public data: any) {} },
  WorkflowResponse: class { constructor(public data: any) {} },
}))

jest.mock("@medusajs/framework/utils", () => ({
  ContainerRegistrationKeys: { QUERY: "query" },
}))

import { computeCostBreakdown, resolveItemCost } from "../estimate-design-cost"
import type { MaterialCostItem } from "../estimate-design-cost"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const orderHistoryMaterials: MaterialCostItem[] = [
  { inventory_item_id: "inv_1", name: "Cotton",  cost: 10, quantity: 2, cost_source: "order_history" },
  { inventory_item_id: "inv_2", name: "Thread",  cost: 5,  quantity: 1, cost_source: "order_history" },
]
// total material cost = 10*2 + 5*1 = 25

const mixedMaterials: MaterialCostItem[] = [
  { inventory_item_id: "inv_1", name: "Cotton",  cost: 10, quantity: 2, cost_source: "order_history" },
  { inventory_item_id: "inv_2", name: "Buttons", cost: 5,  quantity: 1, cost_source: "unit_cost" },
]
// total = 25, but not all from order_history

// ─── computeCostBreakdown ─────────────────────────────────────────────────────

describe("computeCostBreakdown", () => {
  const base = { designId: "d1", similarDesigns: [], hasExactMaterialCosts: false }

  describe("production cost branches", () => {
    it("derives production from admin estimate minus material cost", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 35,         // admin says total = 35
        materials: orderHistoryMaterials,  // material = 25
      })
      expect(result.material_cost).toBe(25)
      expect(result.production_cost).toBe(10)    // 35 - 25
      expect(result.total_estimated).toBe(35)
    })

    it("prefers an actual production cost over the admin-estimate residual (#456)", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 35,                 // would derive production = 35 - 25 = 10
        materials: orderHistoryMaterials,  // material = 25
        actualProductionCost: 50,          // partner's actual per-unit cost wins
      })
      expect(result.material_cost).toBe(25)
      expect(result.production_cost).toBe(50)        // actual, not the 10 residual
      expect(result.total_estimated).toBe(75)        // material + actual production
    })

    it("clamps production to 0 when material cost exceeds admin estimate", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 20,         // admin under-estimated
        materials: orderHistoryMaterials,  // material = 25 > 20
      })
      expect(result.production_cost).toBe(0)
      expect(result.total_estimated).toBe(25)    // material only
    })

    it("splits admin estimate at 30% when no material data", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 130,
        materials: [],
      })
      // materialShare = 130 / 1.3 = 100; productionCost = 30
      expect(result.material_cost).toBe(0)
      expect(result.production_cost).toBeCloseTo(30, 1)
      expect(result.total_estimated).toBeCloseTo(30, 1)
    })

    it("uses similar design average for production when no admin estimate", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25
        similarDesigns: [
          { id: "d2", name: "Shirt A", estimated_cost: 40 },
          { id: "d3", name: "Shirt B", estimated_cost: 50 },
        ], // avg = 45; implied = min(45-25, 25*0.6) = min(20,15) = 15
      })
      expect(result.production_cost).toBe(15)
      expect(result.material_cost).toBe(25)
    })

    it("caps production from similar designs at 60% of material cost", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25
        similarDesigns: [{ id: "d2", name: "Designer Suit", estimated_cost: 200 }],
        // implied = 200-25 = 175 → capped at 25*0.6 = 15
      })
      expect(result.production_cost).toBe(15)
    })

    it("floors production from similar designs at 10% of material cost", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25
        similarDesigns: [{ id: "d2", name: "Cheap Shirt", estimated_cost: 26 }],
        // implied = 26-25 = 1 → floor at 25*0.1 = 2.5
      })
      expect(result.production_cost).toBe(2.5)
    })

    it("defaults to 30% of material cost when no estimate or similar designs", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25
      })
      expect(result.production_cost).toBe(7.5)  // 25 * 0.30
      expect(result.breakdown.production_percent).toBe(30)
    })

    it("returns zero production and zero total when no data at all", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [],
      })
      expect(result.material_cost).toBe(0)
      expect(result.production_cost).toBe(0)
      expect(result.total_estimated).toBe(0)
    })
  })

  describe("partner production-cost override", () => {
    it("uses the partner-entered production cost over the 30% default", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25 → default would be 7.5
        productionCostOverride: 40,
      })
      expect(result.production_cost).toBe(40)
      expect(result.total_estimated).toBe(65) // 25 + 40
    })

    it("beats even an actual completed-run cost (partner typed it)", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 35,
        materials: orderHistoryMaterials,
        actualProductionCost: 50, // would otherwise win
        productionCostOverride: 12,
      })
      expect(result.production_cost).toBe(12)
      expect(result.total_estimated).toBe(37) // 25 + 12
    })

    it("respects an explicit override of 0 (no production cost)", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials,
        productionCostOverride: 0,
      })
      expect(result.production_cost).toBe(0)
      expect(result.total_estimated).toBe(25) // material only
    })
  })

  describe("platform fee", () => {
    it("defaults to 0 and leaves the total unchanged when opted out", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 35,
        materials: orderHistoryMaterials,
      })
      expect(result.platform_fee).toBe(0)
      expect(result.total_estimated).toBe(35)
    })

    it("charges 10% of material cost as a separate line, added to the total", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25, default prod = 7.5
        platformFeePercent: 10,
      })
      expect(result.material_cost).toBe(25)
      expect(result.production_cost).toBe(7.5)
      expect(result.platform_fee).toBe(2.5) // 10% of 25
      expect(result.total_estimated).toBe(35) // 25 + 7.5 + 2.5
      expect(result.breakdown.platform_fee_percent).toBe(10)
    })

    it("combines a partner override with the platform fee", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // material = 25
        productionCostOverride: 40,
        platformFeePercent: 10,
      })
      expect(result.production_cost).toBe(40)
      expect(result.platform_fee).toBe(2.5)
      expect(result.total_estimated).toBe(67.5) // 25 + 40 + 2.5
    })
  })

  describe("per-material commission + default material cost", () => {
    it("attaches a per-material commission that sums to the platform fee", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials, // cotton 10×2=20, thread 5×1=5
        platformFeePercent: 10,
      })
      const items = result.breakdown.materials
      expect(items[0].commission).toBe(2) // 20 × 10%
      expect(items[1].commission).toBe(0.5) // 5 × 10%
      expect(result.platform_fee).toBe(2.5) // sum of per-line commissions
    })

    it("defaults a material with no cost to defaultMaterialCost (600)", () => {
      const materials: MaterialCostItem[] = [
        { name: "Unknown fabric", cost: 0, quantity: 2, cost_source: "estimated" },
      ]
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials,
        defaultMaterialCost: 600,
        platformFeePercent: 10,
      })
      const item = result.breakdown.materials[0]
      expect(item.cost).toBe(600)
      expect(item.cost_source).toBe("default")
      expect(item.commission).toBe(120) // 600×2 × 10%
      expect(result.material_cost).toBe(1200)
      expect(result.platform_fee).toBe(120)
    })

    it("leaves an unset material at 0 when no default is opted in", () => {
      const materials: MaterialCostItem[] = [
        { name: "Unknown fabric", cost: 0, quantity: 2, cost_source: "estimated" },
      ]
      const result = computeCostBreakdown({ ...base, adminEstimate: null, materials })
      expect(result.material_cost).toBe(0)
      expect(result.breakdown.materials[0].cost).toBe(0)
      expect(result.breakdown.materials[0].cost_source).toBe("estimated")
    })
  })

  describe("confidence levels", () => {
    it("returns guesstimate when no real data", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [],
        similarDesigns: [],
      })
      expect(result.confidence).toBe("guesstimate")
    })

    it("returns estimated when admin estimate is set", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 50,
        materials: [],
        similarDesigns: [],
      })
      expect(result.confidence).toBe("estimated")
    })

    it("returns estimated when any material uses unit_cost", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: mixedMaterials,
        hasExactMaterialCosts: false,
      })
      expect(result.confidence).toBe("estimated")
    })

    it("returns estimated when similar designs are used", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials,
        similarDesigns: [{ id: "d2", name: "Similar", estimated_cost: 40 }],
        hasExactMaterialCosts: false,
      })
      expect(result.confidence).toBe("estimated")
    })

    it("returns estimated when component_design costs are present", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [
          { component_design_id: "comp_1", name: "Embroidery", cost: 20, quantity: 1, cost_source: "component_design" },
        ],
        hasExactMaterialCosts: false,
      })
      expect(result.confidence).toBe("estimated")
    })

    it("returns exact when materials are all exact and a concrete admin estimate sets production", () => {
      // hasExactMaterialCosts + a concrete admin estimate (which makes
      // production non-estimated) → confidence is "exact".
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: 35,
        materials: orderHistoryMaterials,
        hasExactMaterialCosts: true,
      })
      expect(result.confidence).toBe("exact")
    })

    it("stays estimated when production is derived (no concrete estimate) even with exact materials", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,            // production falls to the 30% default → estimated
        materials: orderHistoryMaterials,
        hasExactMaterialCosts: true,
      })
      expect(result.confidence).toBe("estimated")
      expect(result.confidence).not.toBe("exact")
    })
  })

  describe("rounding", () => {
    it("rounds all money values to 2 decimal places", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [
          { inventory_item_id: "i1", name: "Linen", cost: 3.333, quantity: 3, cost_source: "order_history" },
        ],
        // material = 9.999 → 10.00; production = 10 * 0.3 = 3.00
      })
      expect(result.material_cost).toBe(10)
      expect(result.production_cost).toBe(3)
      expect(result.total_estimated).toBe(13)
    })
  })

  describe("output shape", () => {
    it("includes similar_designs in output when provided", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials,
        similarDesigns: [{ id: "d2", name: "Similar", estimated_cost: 40 }],
      })
      expect(result.similar_designs).toHaveLength(1)
      expect(result.similar_designs![0].id).toBe("d2")
    })

    it("omits similar_designs key when none provided", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials,
        similarDesigns: [],
      })
      expect(result.similar_designs).toBeUndefined()
    })

    it("sets design_id on the result", () => {
      const result = computeCostBreakdown({
        ...base,
        designId: "design_abc",
        adminEstimate: null,
        materials: [],
      })
      expect(result.design_id).toBe("design_abc")
    })

    it("includes the materials array in breakdown", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: orderHistoryMaterials,
      })
      expect(result.breakdown.materials).toHaveLength(2)
      expect(result.breakdown.materials[0].name).toBe("Cotton")
    })
  })

  describe("component design cost rollup", () => {
    it("includes component cost × quantity in material total", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [
          { component_design_id: "c1", name: "Embroidery", cost: 30, quantity: 2, cost_source: "component_design" },
          { component_design_id: "c2", name: "Patch",      cost: 10, quantity: 5, cost_source: "component_design" },
        ],
        // total material = 30*2 + 10*5 = 110
      })
      expect(result.material_cost).toBe(110)
    })

    it("mixes inventory and component costs in material total", () => {
      const result = computeCostBreakdown({
        ...base,
        adminEstimate: null,
        materials: [
          { inventory_item_id: "i1", name: "Fabric",     cost: 20, quantity: 1, cost_source: "order_history" },
          { component_design_id: "c1", name: "Lining",   cost: 15, quantity: 1, cost_source: "component_design" },
        ],
        // total = 35; production = 35 * 0.3 = 10.5
      })
      expect(result.material_cost).toBe(35)
      expect(result.production_cost).toBe(10.5)
    })
  })
})

// ─── resolveItemCost ──────────────────────────────────────────────────────────

describe("resolveItemCost", () => {
  const item = { id: "inv_1", title: "Cotton", sku: "CTN-01", unit_cost: 8 }

  it("uses latest order history price when available", () => {
    const links = [
      {
        inventory_order_line: {
          price: 15,
          inventory_orders: { order_date: "2024-06-01", status: "Received" },
        },
      },
    ]
    const result = resolveItemCost(item, links)
    expect(result.cost).toBe(15)
    expect(result.cost_source).toBe("order_history")
  })

  it("picks the most recent non-cancelled order line when multiple exist", () => {
    const links = [
      {
        inventory_order_line: {
          price: 7,
          inventory_orders: { order_date: "2023-01-01", status: "Received" },
        },
      },
      {
        inventory_order_line: {
          price: 20,
          inventory_orders: { order_date: "2024-12-01", status: "Received" },
        },
      },
    ]
    const result = resolveItemCost(item, links)
    expect(result.cost).toBe(20)
  })

  it("skips cancelled order lines", () => {
    const links = [
      {
        inventory_order_line: {
          price: 999,
          inventory_orders: { order_date: "2024-08-01", status: "Cancelled" },
        },
      },
      {
        inventory_order_line: {
          price: 15,
          inventory_orders: { order_date: "2024-07-01", status: "Received" },
        },
      },
    ]
    const result = resolveItemCost(item, links)
    expect(result.cost).toBe(15)
    expect(result.cost_source).toBe("order_history")
  })

  it("falls back to unit_cost when no valid order history", () => {
    const result = resolveItemCost(item, [])
    expect(result.cost).toBe(8)
    expect(result.cost_source).toBe("unit_cost")
  })

  it("falls back to unit_cost when all orders are cancelled", () => {
    const links = [
      {
        inventory_order_line: {
          price: 999,
          inventory_orders: { order_date: "2024-08-01", status: "Cancelled" },
        },
      },
    ]
    const result = resolveItemCost(item, links)
    expect(result.cost).toBe(8)
    expect(result.cost_source).toBe("unit_cost")
  })

  it("returns estimated at cost 0 when no order history and no unit_cost", () => {
    const noUnitCostItem = { id: "inv_x", title: "Mystery", unit_cost: null }
    const result = resolveItemCost(noUnitCostItem, [])
    expect(result.cost).toBe(0)
    expect(result.cost_source).toBe("estimated")
  })

  it("returns estimated when unit_cost is 0", () => {
    const zeroCostItem = { id: "inv_x", title: "Free Sample", unit_cost: 0 }
    const result = resolveItemCost(zeroCostItem, [])
    expect(result.cost).toBe(0)
    expect(result.cost_source).toBe("estimated")
  })

  it("handles missing inventory_order_line on link gracefully", () => {
    const links = [{ inventory_order_line: undefined as any }]
    const result = resolveItemCost(item, links)
    expect(result.cost).toBe(8)   // falls back to unit_cost
    expect(result.cost_source).toBe("unit_cost")
  })
})
