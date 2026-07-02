import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

/**
 * Re-project an inventory order's LIVE lines onto its core mirror order's items.
 *
 * The core "unified" order (#342) is a projection built once at creation
 * (dual-write-unified-order.ts) and, until now, only its STATUS was mirrored on
 * update — never its items. So editing an inventory order's lines left the core
 * mirror showing stale items + a stale total (it kept the creation snapshot).
 *
 * Core order totals are CALCULATED from line items on read (verified), so
 * reconciling is simply: make the mirror's line items match the live inventory
 * lines and the total fixes itself. We key items by metadata.legacy_orderline_id
 * and treat a changed line as remove-old + create-fresh (quantity lives on the
 * order_item detail, so in-place updates are avoided).
 */

export interface LiveInventoryLine {
  id: string
  quantity: number
  price: number
  title: string
  inventory_item_id: string | null
}

export interface MirrorItem {
  id: string
  title: string
  quantity: number
  unit_price: number
  legacy_orderline_id: string | null
}

export interface MirrorItemCreate {
  title: string
  quantity: number
  unit_price: number
  metadata: Record<string, unknown>
}

export interface MirrorReprojectPlan {
  create: MirrorItemCreate[]
  removeItemIds: string[]
  unchanged: number
}

/**
 * Pure diff: what must change on the mirror so its items match the live lines.
 * Keyed by legacy_orderline_id. A line that matches an existing item exactly is
 * left untouched; anything else is (re)created, and every mirror item not
 * explicitly kept is removed (stale originals, changed lines, keyless items).
 * Exported for unit testing.
 */
export function planMirrorReprojection(
  liveLines: LiveInventoryLine[],
  mirrorItems: MirrorItem[]
): MirrorReprojectPlan {
  const mirrorByLegacy = new Map<string, MirrorItem>()
  for (const it of mirrorItems) {
    if (it.legacy_orderline_id) {
      mirrorByLegacy.set(it.legacy_orderline_id, it)
    }
  }

  const create: MirrorItemCreate[] = []
  const keepItemIds = new Set<string>()
  let unchanged = 0

  for (const line of liveLines) {
    const existing = mirrorByLegacy.get(line.id)
    if (
      existing &&
      existing.title === line.title &&
      Number(existing.quantity) === line.quantity &&
      Number(existing.unit_price) === line.price
    ) {
      keepItemIds.add(existing.id)
      unchanged++
      continue
    }
    create.push({
      title: line.title,
      quantity: line.quantity,
      unit_price: line.price,
      metadata: {
        inventory_item_id: line.inventory_item_id,
        legacy_orderline_id: line.id,
        legacy_unit_price: line.price,
      },
    })
  }

  const removeItemIds = mirrorItems
    .filter((it) => !keepItemIds.has(it.id))
    .map((it) => it.id)

  return { create, removeItemIds, unchanged }
}

export interface ReprojectSummary {
  inventory_order_id: string
  unified_order_id: string | null
  skipped?: string
  created: number
  removed: number
  unchanged: number
  before_total: number | null
  plan: MirrorReprojectPlan
  dry_run: boolean
}

const EMPTY_PLAN: MirrorReprojectPlan = { create: [], removeItemIds: [], unchanged: 0 }

/**
 * Read the live inventory lines + the current mirror items, compute the plan,
 * and (unless dryRun) apply it via the order module. Never assumes a mirror
 * exists — a legacy order with no projected core order is a no-op ("no_mirror").
 */
export async function reprojectInventoryMirrorItems(
  container: any,
  inventoryOrderId: string,
  opts: { dryRun?: boolean } = {}
): Promise<ReprojectSummary> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const orderService: any = container.resolve(Modules.ORDER)
  const dryRun = !!opts.dryRun

  const { data: invRows } = await query.graph({
    entity: "inventory_orders",
    filters: { id: inventoryOrderId },
    fields: [
      "id",
      "order.id",
      "orderlines.id",
      "orderlines.quantity",
      "orderlines.price",
      "orderlines.material_name",
      "orderlines.inventory_items.id",
      "orderlines.inventory_items.title",
      "orderlines.inventory_items.sku",
    ],
  })
  const inv = invRows?.[0]
  const unifiedOrderId: string | null = inv?.order?.id ?? null
  if (!inv || !unifiedOrderId) {
    return {
      inventory_order_id: inventoryOrderId,
      unified_order_id: null,
      skipped: "no_mirror",
      created: 0,
      removed: 0,
      unchanged: 0,
      before_total: null,
      plan: EMPTY_PLAN,
      dry_run: dryRun,
    }
  }

  const liveLines: LiveInventoryLine[] = (inv.orderlines || []).map((l: any) => ({
    id: String(l.id),
    quantity: Number(l.quantity) || 0,
    price: Number(l.price) || 0,
    title:
      l.material_name ||
      l.inventory_items?.[0]?.title ||
      l.inventory_items?.[0]?.sku ||
      "Raw material",
    inventory_item_id: l.inventory_items?.[0]?.id ?? null,
  }))

  const { data: ordRows } = await query.graph({
    entity: "order",
    filters: { id: unifiedOrderId },
    // `items.*` (wildcard) is what resolves the effective quantity + metadata.
    fields: ["id", "total", "items.*"],
  })
  const mirror = ordRows?.[0]
  const mirrorItems: MirrorItem[] = (mirror?.items || []).map((i: any) => ({
    id: String(i.id),
    title: i.title,
    quantity: Number(i.quantity) || 0,
    unit_price: Number(i.unit_price) || 0,
    legacy_orderline_id: i.metadata?.legacy_orderline_id
      ? String(i.metadata.legacy_orderline_id)
      : null,
  }))

  const plan = planMirrorReprojection(liveLines, mirrorItems)

  const summary: ReprojectSummary = {
    inventory_order_id: inventoryOrderId,
    unified_order_id: unifiedOrderId,
    created: plan.create.length,
    removed: plan.removeItemIds.length,
    unchanged: plan.unchanged,
    before_total: mirror?.total != null ? Number(mirror.total) : null,
    plan,
    dry_run: dryRun,
  }

  if (dryRun) {
    return summary
  }

  // Create fresh items first so the order is never transiently empty, then drop
  // the stale ones. Totals recompute on the next read either way.
  if (plan.create.length) {
    await orderService.createOrderLineItems(unifiedOrderId, plan.create as any)
  }
  if (plan.removeItemIds.length) {
    await orderService.deleteOrderLineItems(plan.removeItemIds)
  }

  return summary
}

/**
 * Best-effort workflow step — mirrors the item projection after a line update.
 * Never throws: a mirror hiccup must not fail (or roll back) the inventory
 * order update. Same contract as mirrorUnifiedOrderStatusStep.
 */
export const reprojectInventoryMirrorItemsStep = createStep(
  "reproject-inventory-mirror-items",
  async (input: { inventoryOrderId: string }, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const summary = await reprojectInventoryMirrorItems(container, input.inventoryOrderId, {})
      if (summary.unified_order_id && (summary.created || summary.removed)) {
        logger.info(
          `[orders-unification] mirror reprojected for ${input.inventoryOrderId}: ` +
            `+${summary.created}/-${summary.removed} items (kept ${summary.unchanged})`
        )
      }
      return new StepResponse(summary)
    } catch (e: any) {
      logger.warn(
        `[orders-unification] mirror item reproject failed for ${input.inventoryOrderId}: ${e?.message}`
      )
      return new StepResponse(null)
    }
  }
)
