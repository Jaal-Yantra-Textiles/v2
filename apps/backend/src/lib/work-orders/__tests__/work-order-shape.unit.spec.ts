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
      created_at: "2026-09-04T08:35:21.000Z",
      title: "Oshen — Shawls",
      quantity: 2,
      unit_price: 400,
      metadata: { design_id: "des_A", production_run_id: "prod_run_A", cost_type: "total", legacy_cost_estimate: 800 },
    },
    {
      id: "ordli_B",
      created_at: "2026-09-04T08:35:22.000Z",
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

  describe("lines store only what is read, as typed columns", () => {
    it("design line keeps design_id + production_run_id; the run's cost is NOT copied", () => {
      const [line] = fromCoreOrder(perRunMirror, null)!.items!
      expect(line).toMatchObject({
        design_id: "01KMDCWAKKXQAQGCT3XQGY8MB8",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
        inventory_order_line_id: null,
      })
      expect(line).not.toHaveProperty("metadata")
      expect(line).not.toHaveProperty("cost_type")
      expect(line).not.toHaveProperty("cost_estimate")
    })

    it("inventory line keeps only the line-sync key", () => {
      const [line] = fromCoreOrder(inventoryMirror, null)!.items!
      expect(line).toMatchObject({ inventory_order_line_id: "orderline_1", design_id: null })
      expect(line).not.toHaveProperty("metadata")
      expect(line).not.toHaveProperty("inventory_item_id")
      expect(JSON.stringify(line)).not.toContain("legacy_unit_price")
    })

    it("served lines echo ONLY the two keys the UI reads into metadata", () => {
      const served = roundTrip(perRunMirror)
      expect(served.items[0].metadata).toEqual({
        design_id: "01KMDCWAKKXQAQGCT3XQGY8MB8",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
      })
    })
  })

  describe("the order stores no metadata; the read keys are synthesised", () => {
    it("the row carries no metadata blob and no guessed-currency flag", () => {
      const row = fromCoreOrder(perRunMirror, null)!
      expect(row).not.toHaveProperty("metadata")
      expect(row).not.toHaveProperty("currency_assumed")
    })

    it("per-run: legacy_id + production_run_id point at the run", () => {
      expect(roundTrip(perRunMirror).metadata).toEqual({
        legacy_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
        production_run_id: "prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W",
      })
    })

    it("collated: legacy_id is the FIRST-created line's run, even when the link lists it second", () => {
      // collatedMirror.production_runs is [B, A]; A's line was created first.
      expect(roundTrip(collatedMirror).metadata).toEqual({
        legacy_id: "prod_run_A",
        collated_design_order: true,
        production_run_ids: ["prod_run_B", "prod_run_A"],
        source_order_id: "order_RETAIL_1",
      })
    })

    it("collated, lines written in the SAME millisecond: the earlier-created RUN decides, not the line id", () => {
      // Found by work-orders-admin-reads (#2264): collateRunsIntoWorkOrder writes
      // every line in one call, so they tie on created_at, and a ULID line id is
      // random within the millisecond. Here the line ids sort the wrong way
      // round on purpose: ordli_A carries the LATER run.
      const at = "2026-09-25T04:58:04.924Z"
      const row = {
        ...fromCoreOrder(collatedMirror, null)!,
        items: [
          { id: "ordli_A", created_at: at, title: "B", quantity: 1, unit_price: 1, production_run_id: "prod_run_B",
            production_run: { id: "prod_run_B", created_at: "2026-09-25T04:58:04.900Z" } },
          { id: "ordli_B", created_at: at, title: "A", quantity: 1, unit_price: 1, production_run_id: "prod_run_A",
            production_run: { id: "prod_run_A", created_at: "2026-09-25T04:58:04.700Z" } },
        ],
      }
      expect(toOrderShape(row).metadata.legacy_id).toBe("prod_run_A")
    })

    it("inventory: legacy_id is the inventory order; its other mirror keys are not carried", () => {
      expect(roundTrip(inventoryMirror).metadata).toEqual({
        legacy_id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF",
      })
    })

    it("a superseded order keeps superseded_by_run_ids (payment supersession reads it)", () => {
      const served = roundTrip({
        ...perRunMirror,
        status: "canceled",
        metadata: { ...perRunMirror.metadata, superseded_by_run_ids: ["prod_run_C1", "prod_run_C2"] },
      })
      expect(served.metadata.superseded_by_run_ids).toEqual(["prod_run_C1", "prod_run_C2"])
    })
  })

  it("carries the typed order facts the mirror hid in metadata", () => {
    const row = fromCoreOrder(collatedMirror, "partner_1")!
    expect(row).toMatchObject({
      kind: "design",
      partner_id: "partner_1",
      source_order_id: "order_RETAIL_1",
      production_runs: [{ id: "prod_run_B" }, { id: "prod_run_A" }],
      inventory_order_id: null,
    })
    expect(fromCoreOrder(inventoryMirror, null)!).toMatchObject({
      kind: "inventory",
      collation: "per_run",
      inventory_order_id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF",
      production_runs: [],
    })
  })
})
