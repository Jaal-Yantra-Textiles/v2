import { Modules } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type { RunStockTarget } from "./run-output-variants"
import { resolveRunVariant } from "./run-variant"

/**
 * #2401 — a piece the partner sold offline is not in their warehouse.
 *
 * Sharlho's Ivory run (2026-10-12) had all 10 pieces sold offline, and closing
 * it banked +10 anyway; the founder zeroed it by hand. Two rules close that:
 *
 *  1. Closing a run banks made − already sold (`bankAfterSales`).
 *  2. A sale reported AFTER the close takes its pieces back off the stock the
 *     close added (`deductSaleFromBankedStock`), and deleting that sale puts
 *     them back (`restoreSaleToBankedStock`).
 *
 * What came off is written on the sale's own metadata, so a delete restores
 * exactly that and never a guess.
 */

export type BankAfterSales = {
  good_quantity: number
  target: RunStockTarget | null
  /** Sold pieces that could not be taken off, with why. 0 when all were. */
  sold_not_deducted: number
  reason: string | null
}

/**
 * PURE: what closing a run should bank once the pieces already sold are out.
 *
 * A run banked line by line (sizes/colours) can only be reduced when it has
 * ONE line: a sale does not say which size it was, and taking it off the first
 * line would be a guess. That case banks in full and says so.
 */
export function bankAfterSales(input: {
  good_quantity: number
  sold_quantity: number
  target?: RunStockTarget | null
}): BankAfterSales {
  const good = Math.max(0, Number(input.good_quantity) || 0)
  const sold = Math.max(0, Number(input.sold_quantity) || 0)
  const target = input.target ?? null
  if (sold <= 0) {
    return { good_quantity: good, target, sold_not_deducted: 0, reason: null }
  }

  if (target?.mode === "lines") {
    if (target.lines.length !== 1) {
      return {
        good_quantity: good,
        target,
        sold_not_deducted: sold,
        reason: `the run banks ${target.lines.length} size/colour lines and a sale does not say which`,
      }
    }
    const [line] = target.lines
    const left = Math.max(0, Number(line.quantity) - sold)
    return {
      good_quantity: Math.max(0, good - sold),
      target: { ...target, lines: [{ ...line, quantity: left }] },
      sold_not_deducted: Math.max(0, sold - Number(line.quantity)),
      reason: null,
    }
  }

  return {
    good_quantity: Math.max(0, good - sold),
    target,
    sold_not_deducted: Math.max(0, sold - good),
    reason: null,
  }
}

export async function soldQuantityForRun(scope: any, runId: string): Promise<number> {
  const service: any = scope.resolve(PRODUCTION_RUNS_MODULE)
  const sales = await service.listProductionRunSales({ production_run_id: runId })
  return (sales ?? []).reduce((acc: number, s: any) => acc + (Number(s.quantity) || 0), 0)
}

export type SaleStockEffect =
  | { deducted: number; inventory_item_id: string; location_id: string }
  | { deducted: 0; reason: string }

/**
 * Take a just-reported sale off the stock its run's close banked. A sale made
 * before the close needs nothing here: `bankAfterSales` already left it out.
 *
 * Never below zero. The partner may have counted, moved or sold some stock
 * another way since the close; what could not come off is recorded, not
 * forced.
 */
export async function deductSaleFromBankedStock(
  scope: any,
  run: any,
  quantity: number
): Promise<SaleStockEffect> {
  if (!run?.stocked_at || !run?.stocked_at_location_id) {
    return { deducted: 0, reason: "run_not_banked" }
  }
  const variant = await resolveRunVariant(scope, {
    variant_id: run.variant_id ?? null,
    approved_variant_id: run.approved_variant_id ?? null,
    design_id: run.design_id ?? null,
  })
  if (!variant.inventory_item_id) {
    return { deducted: 0, reason: variant.reason ?? "no_inventory_item" }
  }

  const inventory: any = scope.resolve(Modules.INVENTORY)
  const locationId = String(run.stocked_at_location_id)
  const [level] = await inventory.listInventoryLevels({
    inventory_item_id: variant.inventory_item_id,
    location_id: locationId,
  })
  if (!level) {
    return { deducted: 0, reason: "no_level_at_banked_location" }
  }
  const take = Math.min(Math.max(0, quantity), Math.max(0, Number(level.stocked_quantity) || 0))
  if (take <= 0) {
    return { deducted: 0, reason: "banked_stock_already_zero" }
  }
  await inventory.adjustInventory(variant.inventory_item_id, locationId, -take)
  return { deducted: take, inventory_item_id: variant.inventory_item_id, location_id: locationId }
}

/** Undo exactly what `deductSaleFromBankedStock` recorded on the sale. */
export async function restoreSaleToBankedStock(scope: any, sale: any): Promise<number> {
  const effect = sale?.metadata?.stock_effect
  const qty = Number(effect?.deducted) || 0
  if (qty <= 0 || !effect?.inventory_item_id || !effect?.location_id) {
    return 0
  }
  const inventory: any = scope.resolve(Modules.INVENTORY)
  await inventory.adjustInventory(effect.inventory_item_id, effect.location_id, qty)
  return qty
}
