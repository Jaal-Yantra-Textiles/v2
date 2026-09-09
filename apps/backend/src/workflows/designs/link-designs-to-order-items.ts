import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import designOrderLineItemLink from "../../links/design-order-line-item-link"
import { DESIGN_MODULE } from "../../modules/designs"

export type ItemLinkResult = {
  linked: number
  skipped_existing: number
  /** Items carrying a design_id we could not link, with the reason. */
  unresolved: Array<{ line_item_id: string; design_id: string; reason: string }>
  pairs: Array<{ line_item_id: string; design_id: string }>
}

/**
 * #1919 — turn each order item's `metadata.design_id` string into a real
 * `design ↔ order_line_item` link.
 *
 * Companion to `linkDesignsToOrder`, which links designs to the ORDER. That
 * one can say five designs are involved; it cannot say which item is which,
 * so a deviated order cannot be re-pointed and the revision lineage is
 * invisible from the order (#1918).
 *
 * `metadata.design_id` is NOT removed. It stays as provenance — what the item
 * was ordered as — while the link records what it is for now. `source` on
 * `resolveLineItemDesignId` is how a reader tells the two apart.
 *
 * Idempotent in the only way that counts: existing pairs are read FIRST and
 * skipped. `remoteLink.create` is not idempotent on its own, and a duplicate
 * on a link the rest of the system treats as one-per-item is the failure that
 * makes a design unquotable (#1918). Shared by the order.placed subscriber,
 * the backfill and the maintenance job so there is exactly one writer.
 */
export async function linkDesignsToOrderItems(
  container: MedusaContainer,
  orderId: string,
  opts?: { dryRun?: boolean }
): Promise<ItemLinkResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "items.id", "items.metadata"],
    filters: { id: orderId },
  })
  const items: any[] = orders?.[0]?.items || []

  const wanted: Array<{ line_item_id: string; design_id: string }> = []
  const unresolved: ItemLinkResult["unresolved"] = []

  for (const item of items) {
    const designId = item?.metadata?.design_id
    if (typeof designId !== "string" || !designId) continue
    if (!item?.id) continue
    wanted.push({ line_item_id: String(item.id), design_id: designId })
  }

  if (!wanted.length) {
    return { linked: 0, skipped_existing: 0, unresolved, pairs: [] }
  }

  /**
   * A `metadata.design_id` can name a design that no longer exists — the
   * string was never a foreign key and nothing stopped a design being
   * deleted out from under it. Linking to a missing design would create a
   * dangling row that reads as a real binding, so those are REPORTED instead.
   */
  const { data: designs } = await query.graph({
    entity: "design",
    fields: ["id"],
    filters: { id: [...new Set(wanted.map((w) => w.design_id))] },
  })
  const live = new Set((designs || []).map((d: any) => String(d.id)))

  // Existing pairs, read through the link's entryPoint — never by traversing
  // from the design entity, which returns no key at all when the field is
  // missing rather than erroring.
  const { data: existing } = await query.graph({
    entity: designOrderLineItemLink.entryPoint,
    fields: ["design_id", "order_line_item_id"],
    filters: { order_line_item_id: wanted.map((w) => w.line_item_id) },
  })
  const alreadyLinked = new Set(
    (existing || []).map((r: any) => String(r.order_line_item_id))
  )

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const pairs: ItemLinkResult["pairs"] = []
  let linked = 0
  let skippedExisting = 0

  for (const w of wanted) {
    if (!live.has(w.design_id)) {
      unresolved.push({ ...w, reason: "design no longer exists" })
      continue
    }
    if (alreadyLinked.has(w.line_item_id)) {
      skippedExisting++
      continue
    }
    if (!opts?.dryRun) {
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: w.design_id },
        [Modules.ORDER]: { order_line_item_id: w.line_item_id },
      })
    }
    linked++
    pairs.push(w)
  }

  return { linked, skipped_existing: skippedExisting, unresolved, pairs }
}

/**
 * Move an item's design binding — the operation the string could never
 * support, and the whole reason #1921 was blocked.
 *
 * Deletes any existing link for the item and creates the new one. Passing
 * `null` leaves the item design-LESS, which #1918 requires to be
 * distinguishable from "never had a design": an item that never had one has
 * no link row AND no `metadata.design_id`, whereas an unlinked one keeps its
 * provenance string.
 */
export async function repointOrderItemDesign(
  container: MedusaContainer,
  lineItemId: string,
  designId: string | null,
  opts?: { dryRun?: boolean }
): Promise<{ removed: number; created: boolean }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

  const { data: existing } = await query.graph({
    entity: designOrderLineItemLink.entryPoint,
    fields: ["design_id", "order_line_item_id"],
    filters: { order_line_item_id: lineItemId },
  })

  let removed = 0
  for (const row of existing || []) {
    if (String(row.design_id) === String(designId)) continue // already correct
    if (!opts?.dryRun) {
      await remoteLink.dismiss({
        [DESIGN_MODULE]: { design_id: row.design_id },
        [Modules.ORDER]: { order_line_item_id: lineItemId },
      })
    }
    removed++
  }

  const alreadyCorrect = (existing || []).some(
    (r: any) => String(r.design_id) === String(designId)
  )
  if (!designId || alreadyCorrect) {
    return { removed, created: false }
  }

  if (!opts?.dryRun) {
    await remoteLink.create({
      [DESIGN_MODULE]: { design_id: designId },
      [Modules.ORDER]: { order_line_item_id: lineItemId },
    })
  }
  return { removed, created: true }
}
