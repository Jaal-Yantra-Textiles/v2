jest.mock("../run-variant", () => ({ resolveRunVariant: jest.fn() }))

import { Modules } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import {
  bankAfterSales,
  deductSaleFromBankedStock,
  restoreSaleToBankedStock,
  soldQuantityForRun,
} from "../profit-share-stock"
import { resolveRunVariant } from "../run-variant"

const line = (quantity: number) =>
  ({ size_label: null, color: null, quantity, variant_id: "v1", inventory_item_id: "i1" }) as any

describe("bankAfterSales (#2401)", () => {
  it("Sharlho's Ivory run: 10 made, 10 sold offline → banks 0", () => {
    const r = bankAfterSales({ good_quantity: 10, sold_quantity: 10, target: { mode: "legacy" } })
    expect(r.good_quantity).toBe(0)
    expect(r.sold_not_deducted).toBe(0)
  })

  it("banks made − sold, and nothing changes with no sales", () => {
    expect(bankAfterSales({ good_quantity: 10, sold_quantity: 4 }).good_quantity).toBe(6)
    expect(bankAfterSales({ good_quantity: 10, sold_quantity: 0 }).good_quantity).toBe(10)
  })

  it("never banks below zero, and says what it could not take off", () => {
    const r = bankAfterSales({ good_quantity: 3, sold_quantity: 5 })
    expect(r.good_quantity).toBe(0)
    expect(r.sold_not_deducted).toBe(2)
  })

  it("reduces a single banked line", () => {
    const r = bankAfterSales({
      good_quantity: 10,
      sold_quantity: 4,
      target: { mode: "lines", product_id: "p", minted_product: false, lines: [line(10)] },
    })
    expect((r.target as any).lines[0].quantity).toBe(6)
    expect(r.good_quantity).toBe(6)
  })

  it("does not guess which size a sale was: several lines bank in full", () => {
    const target = { mode: "lines", product_id: "p", minted_product: false, lines: [line(5), line(5)] } as any
    const r = bankAfterSales({ good_quantity: 10, sold_quantity: 4, target })
    expect(r.target).toBe(target)
    expect(r.good_quantity).toBe(10)
    expect(r.sold_not_deducted).toBe(4)
    expect(r.reason).toMatch(/2 size\/colour lines/)
  })
})

describe("sale stock effects (#2401)", () => {
  const makeScope = (level: any, sales: any[] = []) => {
    const inventory = {
      listInventoryLevels: jest.fn().mockResolvedValue(level ? [level] : []),
      adjustInventory: jest.fn().mockResolvedValue({}),
    }
    const runs = { listProductionRunSales: jest.fn().mockResolvedValue(sales) }
    const scope = {
      resolve: (k: string) => (k === Modules.INVENTORY ? inventory : k === PRODUCTION_RUNS_MODULE ? runs : null),
    }
    return { scope, inventory }
  }
  const banked = { stocked_at: new Date(), stocked_at_location_id: "sloc_1", variant_id: "v1" }

  beforeEach(() => {
    ;(resolveRunVariant as jest.Mock).mockResolvedValue({ inventory_item_id: "iitem_1" })
  })

  it("sums reported sales", async () => {
    const { scope } = makeScope(null, [{ quantity: 4 }, { quantity: "6" }])
    expect(await soldQuantityForRun(scope, "run")).toBe(10)
  })

  it("a sale after the close comes off the banked stock", async () => {
    const { scope, inventory } = makeScope({ stocked_quantity: 6 })
    const r = await deductSaleFromBankedStock(scope, banked, 4)
    expect(r).toEqual({ deducted: 4, inventory_item_id: "iitem_1", location_id: "sloc_1" })
    expect(inventory.adjustInventory).toHaveBeenCalledWith("iitem_1", "sloc_1", -4)
  })

  it("never takes stock below zero", async () => {
    const { scope, inventory } = makeScope({ stocked_quantity: 2 })
    const r = await deductSaleFromBankedStock(scope, banked, 5)
    expect(r.deducted).toBe(2)
    expect(inventory.adjustInventory).toHaveBeenCalledWith("iitem_1", "sloc_1", -2)
  })

  it("a sale before the close moves nothing (the close leaves it out)", async () => {
    const { scope, inventory } = makeScope({ stocked_quantity: 6 })
    const r = await deductSaleFromBankedStock(scope, { stocked_at: null }, 4)
    expect(r).toEqual({ deducted: 0, reason: "run_not_banked" })
    expect(inventory.adjustInventory).not.toHaveBeenCalled()
  })

  it("a run with no single variant is not guessed at", async () => {
    ;(resolveRunVariant as jest.Mock).mockResolvedValue({ reason: "ambiguous_design_variants" })
    const { scope, inventory } = makeScope({ stocked_quantity: 6 })
    const r = await deductSaleFromBankedStock(scope, banked, 4)
    expect(r).toEqual({ deducted: 0, reason: "ambiguous_design_variants" })
    expect(inventory.adjustInventory).not.toHaveBeenCalled()
  })

  it("deleting a sale puts back exactly what it took", async () => {
    const { scope, inventory } = makeScope(null)
    const n = await restoreSaleToBankedStock(scope, {
      metadata: { stock_effect: { deducted: 2, inventory_item_id: "iitem_1", location_id: "sloc_1" } },
    })
    expect(n).toBe(2)
    expect(inventory.adjustInventory).toHaveBeenCalledWith("iitem_1", "sloc_1", 2)
    expect(await restoreSaleToBankedStock(scope, { metadata: null })).toBe(0)
  })
})
