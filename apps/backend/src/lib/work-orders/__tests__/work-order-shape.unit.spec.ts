import { fromCoreOrder } from "../from-core-order"
import { toOrderShape } from "../to-order-shape"
import {
  pickWorkOrderContract,
  pickWorkOrderListContract,
} from "../work-order-contract"

/**
 * #2262 S0 — a mirror converted to a work_order row and served back must read
 * the SAME to the UI as the mirror did. Fixtures are shaped on real prod mirrors
 * (2026-09-24): order_01KVB3FCA39K975H2N5AHVJ3AD is the per-run one below.
 */

const perRunMirror = {
  id: "order_01KVB3FCA39K975H2N5AHVJ3AD",
  display_id: 26,
  status: "completed",
  currency_code: "inr",
  created_at: "2026-06-17T15:33:54.628Z",
  updated_at: "2026-06-18T15:14:25.927Z",
  canceled_at: null,
  total: 68850,
  metadata: {
    source: "admin.designs.manual",
    run_type: "production",
    legacy_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
    execution_mode: "in_house",
    source_order_id: null,
    currency_assumed: true,
    production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
  },
  items: [
    {
      id: "ordli_01KVB3FCA3EK51ZT6R27R73B4H",
      title: "Bakshi's Design",
      subtitle: null,
      thumbnail: null,
      quantity: 9,
      unit_price: 7650,
      metadata: {
        cost_type: "per_unit",
        design_id: "01KMDCWAKKXQAQGCT3XQGY8MB8",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
        legacy_cost_estimate: 7650,
      },
    },
  ],
  production_runs: [{ id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W" }],
  inventory_orders: null,
  unified_order_status: { id: "uos_1", partner_status: "completed" },
  unified_order_kind: null,
}

const collatedMirror = {
  ...perRunMirror,
  id: "order_COLLATED",
  display_id: 90,
  status: "pending",
  total: 1300,
  metadata: {
    collated_design_order: true,
    production_run_ids: ["prod_run_A", "prod_run_B"],
    legacy_id: "prod_run_A",
    source_order_id: "order_RETAIL_1",
  },
  items: [
    {
      id: "ordli_A",
      title: "Oshen — Shawls",
      quantity: 2,
      unit_price: 400,
      metadata: { design_id: "des_A", production_run_id: "prod_run_A", cost_type: "total", legacy_cost_estimate: 800 },
    },
    {
      id: "ordli_B",
      title: "Oshen — Scarves",
      quantity: 2,
      unit_price: 250,
      metadata: { design_id: "des_B", production_run_id: "prod_run_B", cost_type: "per_unit", legacy_cost_estimate: 250 },
    },
  ],
  production_runs: [{ id: "prod_run_B" }, { id: "prod_run_A" }],
  unified_order_status: null,
  unified_order_kind: { id: "uok_1", kind: "collated" },
}

const inventoryMirror = {
  id: "order_INV",
  display_id: 120,
  status: "pending",
  currency_code: "inr",
  created_at: "2026-09-08T03:33:30.408Z",
  updated_at: "2026-09-21T09:57:41.186Z",
  canceled_at: null,
  total: 50100,
  metadata: { legacy_id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF", is_sample: false },
  items: [
    {
      id: "ordli_I1",
      title: "60lea Linen",
      quantity: 70.6,
      unit_price: 690,
      metadata: { inventory_item_id: "iitem_1", legacy_orderline_id: "orderline_1", legacy_unit_price: 690 },
    },
    {
      id: "ordli_I2",
      title: "Mulberry Silk 3/4",
      quantity: 1.2,
      unit_price: 1155,
      metadata: { inventory_item_id: "iitem_2", legacy_orderline_id: "orderline_2", legacy_unit_price: 1155 },
    },
  ],
  production_runs: [],
  inventory_orders: { id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF" },
  unified_order_status: { partner_status: "finished" },
  unified_order_kind: null,
}

const roundTrip = (mirror: any) => {
  const row = fromCoreOrder(mirror, "partner_1")
  expect(row).not.toBeNull()
  return toOrderShape(row!)
}

describe("work order: mirror → work_order → core-order shape (#2262 S0)", () => {
  it.each([
    ["per-run design", perRunMirror],
    ["collated design", collatedMirror],
  ])("%s reads the same to the UI", (_label, mirror) => {
    const served = roundTrip(mirror)
    expect(pickWorkOrderContract(served)).toEqual(pickWorkOrderContract(mirror))
    expect(pickWorkOrderListContract(served)).toEqual(pickWorkOrderListContract(mirror))
  })

  it("inventory order reads the same, including a fractional-metre total", () => {
    // 70.6 × 690 + 1.2 × 1155 = 48714 + 1386 = 50100 — exact, not 50099.99999
    const served = roundTrip(inventoryMirror)
    expect(served.total).toBe(50100)
    expect(pickWorkOrderContract(served)).toEqual(pickWorkOrderContract(inventoryMirror))
  })

  it("a legacy collated order with NO sidecar is still collated (metadata fallback)", () => {
    const legacy = { ...collatedMirror, unified_order_kind: null }
    const row = fromCoreOrder(legacy, null)!
    expect(row.collation).toBe("collated")
    expect(pickWorkOrderContract(toOrderShape(row)).collated).toBe(true)
  })

  it("an explicit per_run sidecar beats a stale metadata flag", () => {
    const row = fromCoreOrder(
      { ...collatedMirror, unified_order_kind: { kind: "per_run" } },
      null
    )!
    expect(row.collation).toBe("per_run")
  })

  it("a retail order (no execution link) is NOT a work order", () => {
    expect(
      fromCoreOrder({ ...perRunMirror, production_runs: [], inventory_orders: null }, null)
    ).toBeNull()
  })

  it("no partner-tracked state serves unified_order_status as null, like the mirror", () => {
    const served = roundTrip(collatedMirror)
    expect(served.unified_order_status).toBeNull()
    expect(pickWorkOrderContract(served).partner_status).toBeNull()
  })

  describe("line facts are typed columns, not metadata", () => {
    it("design line", () => {
      const [line] = fromCoreOrder(perRunMirror, null)!.items!
      expect(line).toMatchObject({
        design_id: "01KMDCWAKKXQAQGCT3XQGY8MB8",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
        cost_type: "per_unit",
        cost_estimate: 7650,
        inventory_item_id: null,
        inventory_order_line_id: null,
      })
      expect(line).not.toHaveProperty("metadata")
    })

    it("inventory line — legacy_unit_price is not carried", () => {
      const [line] = fromCoreOrder(inventoryMirror, null)!.items!
      expect(line).toMatchObject({
        inventory_item_id: "iitem_1",
        inventory_order_line_id: "orderline_1",
        design_id: null,
        cost_type: null,
      })
      expect(line).not.toHaveProperty("metadata")
      expect(JSON.stringify(line)).not.toContain("legacy_unit_price")
    })

    it("an unknown cost_type is refused, not stored", () => {
      const mirror = {
        ...perRunMirror,
        items: [{ ...perRunMirror.items[0], metadata: { ...perRunMirror.items[0].metadata, cost_type: "per_metre" } }],
      }
      expect(fromCoreOrder(mirror, null)!.items![0].cost_type).toBeNull()
    })

    it("served lines echo ONLY the two keys the UI reads into metadata", () => {
      const served = roundTrip(perRunMirror)
      expect(served.items[0].metadata).toEqual({
        design_id: "01KMDCWAKKXQAQGCT3XQGY8MB8",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
      })
    })
  })

  it("carries the typed order facts the mirror hid in metadata", () => {
    const row = fromCoreOrder(collatedMirror, "partner_1")!
    expect(row).toMatchObject({
      kind: "design",
      partner_id: "partner_1",
      source_order_id: "order_RETAIL_1",
      production_run_ids: ["prod_run_B", "prod_run_A"],
      inventory_order_id: null,
    })
    expect(fromCoreOrder(perRunMirror, null)!.currency_assumed).toBe(true)
    expect(fromCoreOrder(inventoryMirror, null)!).toMatchObject({
      kind: "inventory",
      collation: "per_run",
      inventory_order_id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF",
      production_run_ids: null,
    })
  })
})
