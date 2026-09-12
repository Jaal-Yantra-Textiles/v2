// #1112 — shared traversal for resolving a retail order line item to its
// backing design (if any) and the idempotency guard both the payment
// (`order.placed`) and fulfillment (`order.fulfillment_created`) run-creation
// paths use. Keeping it in one place guarantees the two paths agree so they
// never double-create a run for the same line item.

import designOrderLineItemLink from "../links/design-order-line-item-link"

// Postgres unique_violation SQLSTATE — raised when the partial unique index on
// production_runs.order_line_item_id catches a concurrent double-create (#1123).
export const PLAN_UNIQUE_VIOLATION = "23505"

export type ResolvedLineItemDesign = {
  designId: string | null
  isCustomDesign: boolean
  /**
   * WHERE the answer came from. A caller that is about to write something
   * durable off this design — a production run, a payout, a re-point — needs
   * to know whether it is standing on a link it can move or on a string it
   * cannot.
   *
   *   · "link"     — the design_order_line_item link. Authoritative, movable.
   *   · "variant"  — design_product_variant. A custom design's own variant.
   *   · "product"  — product_design. The catalogue-level association.
   *   · "metadata" — `metadata.design_id`, provenance only. Means this item
   *                  predates the backfill, or the backfill missed it.
   *   · null       — nothing resolved.
   */
  source: "link" | "variant" | "product" | "metadata" | null
}

/**
 * Resolve the design linked to a line item — variant-level link (custom designs
 * from the design editor) takes priority over the product-level link.
 */
export async function resolveLineItemDesignId(
  query: any,
  {
    productId,
    variantId,
    lineItemId,
    metadata,
  }: {
    productId?: string | null
    variantId?: string | null
    /**
     * The ORDER line item's id. Without it a design-order item — which has
     * neither a product nor a variant — cannot be resolved at all, which is
     * how five paid-for designs on `order_01KNP520PT94BN8SC0JKZ6ZVJ9` reached
     * `order-placed.ts` and were skipped (#1918).
     */
    lineItemId?: string | null
    /** The item's `metadata`, for the provenance fallback. */
    metadata?: Record<string, any> | null
  }
): Promise<ResolvedLineItemDesign> {
  let designId: string | null = null
  let isCustomDesign = false

  /**
   * The link wins over everything, including `metadata.design_id`. After an
   * order edit re-points an item (#1921) the metadata still records what was
   * ORIGINALLY ordered — that is the point of keeping it — so reading it in
   * preference to the link would hand back the design the customer is no
   * longer getting.
   */
  if (lineItemId) {
    /**
     * 🔴 `take: 1` with NO ORDER is a lottery, not a lookup (#1983's family).
     *
     * `repointOrderItemDesign` dismisses the old link and creates the new one
     * as two separate writes, so this table can hold more than one row for an
     * item — and an unordered `take: 1` then returns the design the customer
     * is NO LONGER GETTING, roughly half the time. That is what has been
     * failing `sibling_items[0]` on main: not an ordering quirk in the test,
     * a row-order roulette in the canonical resolver that every run-creation
     * path reads.
     *
     * Newest wins, because a re-point writes the new row last. The defect is
     * the ABSENCE of an order, not this particular choice of one.
     */
    const { data: itemLinks } = await query.graph({
      entity: designOrderLineItemLink.entryPoint,
      fields: ["design_id"],
      filters: { order_line_item_id: lineItemId },
      pagination: { skip: 0, take: 1, order: { created_at: "DESC" } },
    })
    const itemLink = (itemLinks || [])[0]
    if (itemLink?.design_id) {
      return {
        designId: itemLink.design_id,
        isCustomDesign: true,
        source: "link",
      }
    }
  }

  if (variantId) {
    const { data: variantDesignLinks } = await query.graph({
      entity: "design_product_variant",
      fields: ["design_id"],
      filters: { product_variant_id: variantId },
      // Same lottery one level down: #1874 lets a design accumulate variants,
      // so this stops being a single-row table the moment that ships.
      pagination: { skip: 0, take: 1, order: { created_at: "DESC" } },
    })
    const variantLink = (variantDesignLinks || [])[0]
    if (variantLink?.design_id) {
      return {
        designId: variantLink.design_id,
        isCustomDesign: true,
        source: "variant",
      }
    }
  }

  if (!designId && productId) {
    const { data: productDesignLinks } = await query.graph({
      entity: "product_design",
      fields: ["design.*"],
      filters: { product_id: productId },
      pagination: { skip: 0, take: 1, order: { created_at: "DESC" } },
    })
    designId = (productDesignLinks || [])[0]?.design?.id || null
    if (designId) {
      return { designId, isCustomDesign, source: "product" }
    }
  }

  /**
   * Last: the string. Only fires for an item the backfill has not reached —
   * a design order placed before the link existed. Reported as "metadata" so
   * a caller can tell a real binding from a legacy one rather than treating
   * the two as interchangeable.
   */
  const fromMetadata = metadata?.design_id
  if (typeof fromMetadata === "string" && fromMetadata) {
    return { designId: fromMetadata, isCustomDesign: true, source: "metadata" }
  }

  return { designId: null, isCustomDesign: false, source: null }
}

/**
 * Idempotency guard shared by both run-creation paths: true when a production
 * run already exists for this line item (regardless of which path created it).
 */
export async function hasProductionRunForLineItem(
  query: any,
  lineItemId: string
): Promise<boolean> {
  return (await getProductionRunForLineItem(query, lineItemId)) !== null
}

export type LineItemProductionRun = {
  id: string
  status: string
  produced_quantity: number | null
  design_id: string | null
  metadata: Record<string, any> | null
}

/**
 * Like {@link hasProductionRunForLineItem} but returns the existing run's id +
 * status (and the fields the reconcile path needs) so the fulfillment path can
 * decide whether to complete it (still pre-production, i.e. shipped from stock)
 * vs leave it (production already underway, #1126), bump its produced quantity
 * on a later fulfillment, or soft-delete it on cancellation (#1123).
 */
export async function getProductionRunForLineItem(
  query: any,
  lineItemId: string
): Promise<LineItemProductionRun | null> {
  const { data: existing } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "produced_quantity", "design_id", "metadata"],
    filters: { order_line_item_id: lineItemId },
    /**
     * 🔑 Ordered, because `take: 1` over a set that CAN hold more than one row
     * is a lottery — and this answer decides whether a run is completed, left
     * alone, or never created (`plan-fulfillment-production-runs`,
     * `change-order-item-design`, `reconcile-provenance-runs` all branch on it).
     *
     * Measured on prod 2026-09-12: 22 runs carry an `order_line_item_id`, all
     * live, exactly one per line — so the lottery cannot fire TODAY. This is
     * #1983's shape: correct by luck, not by construction.
     *
     * ⚠️ Parent/child pairs do NOT arm it — 0 of 53 children and 0 of 52
     * parents carry an `order_line_item_id` at all. What would arm it is a
     * second run created for a line that already has one (a cancelled run that
     * keeps its link, a re-created run after a design change). No cancelled run
     * on prod retains a line item today, which is why one row is all that comes
     * back.
     *
     * Newest wins, matching the design-link resolver above: where two runs
     * exist, the later one is the current intent. Deliberately NOT filtering by
     * status here — whether a cancelled run should still answer "a run exists"
     * changes what the callers do, and that is a decision to take on evidence
     * rather than to slip into an ordering fix.
     */
    pagination: { skip: 0, take: 1, order: { created_at: "DESC" } },
  })
  const run = (existing || [])[0]
  return run
    ? {
        id: run.id,
        status: run.status,
        produced_quantity: run.produced_quantity ?? null,
        design_id: run.design_id ?? null,
        metadata: run.metadata ?? null,
      }
    : null
}

/**
 * Does ANY production run exist for this design, regardless of which order line
 * it belongs to?
 *
 * 🔴 The distinction this exists to draw: a line item with no run of its own is
 * not the same as a design nobody has made. On prod, order #3's five items carry
 * a null `variant_id` (#1918), so no run was ever stamped with their
 * `order_line_item_id` — while each of their designs has TWO completed runs.
 * Asking only the line item therefore answered "nothing has been started" about
 * garments that were finished, and a customer was told exactly that.
 *
 * The answer is deliberately a BOOLEAN, not the run. A run for the design says
 * somebody made this design once; it does NOT say it was made for this order,
 * and designs are reused across customers. So it is enough to stop us claiming
 * "not started" — and not enough to claim "already made".
 */
export async function hasProductionRunForDesign(
  query: any,
  designId: string | null | undefined
): Promise<boolean> {
  if (!designId) return false
  try {
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["id"],
      filters: { design_id: designId },
      pagination: { skip: 0, take: 1 },
    })
    return Boolean((data || [])[0])
  } catch {
    // Unknowable is not the same as absent: fail toward "we do not know",
    // which the caller renders as a claim about our records, not the world.
    return true
  }
}

/**
 * A provenance run this system minted from retail fulfillment (born terminal).
 * ONLY these are quantity-reconciled / soft-deleted by the fulfillment +
 * cancellation paths — a real production run (design work-order, or a run that
 * actually went through the shop) is never touched.
 *
 * Identified SOLELY by the create-side marker
 * `metadata.source === "order.fulfillment_created"`, which is written in exactly
 * one place (`reconcile-provenance-runs.ts`) and never by any path that mints a
 * real run. That marker alone is therefore sufficient.
 *
 * It previously ALSO required `design_id == null`, on the assumption that
 * provenance runs are product-only. They are not: the same creator mints
 * DESIGN-BACKED provenance runs whenever the fulfilled line resolves to a design
 * (it stamps `design_backed: true` alongside the marker). Those runs matched the
 * marker but failed the null check, so they were never adjusted when the
 * fulfilled quantity changed and — worse — were never soft-deleted when the
 * order was canceled, leaving a completed run claiming goods that never shipped.
 */
export function isOwnedProvenanceRun(
  run: Pick<LineItemProductionRun, "design_id" | "metadata"> | null | undefined
): boolean {
  if (!run) return false
  return run.metadata?.source === "order.fulfillment_created"
}

/**
 * #1920 (item 3) — "do not auto-produce this line item", as an EXPLICIT flag.
 *
 * Until now the suppression was an EMERGENT PROPERTY of a missing field:
 * `convert-design-order.ts` builds TITLE-ONLY order items, so the automatic
 * run-creation paths hit `if (!productId) continue` and skipped them. Nothing
 * anywhere said "don't produce this" — the absence of a `product_id` said it,
 * by accident.
 *
 * That coincidence is load-bearing in two directions and wrong in both:
 *
 *  · #1919 made design-order items RESOLVABLE, so the `!productId` guard now
 *    looks like dead weight. Remove it without this flag and every converted
 *    design order starts auto-producing customer orders.
 *  · The same absent field ALSO suppressed five paid-for design items on
 *    `order_01KNP520PT94BN8SC0JKZ6ZVJ9` that SHOULD have produced (#1918).
 *    One condition was standing in for two opposite intentions.
 *
 * So: the intention is now written down. `no_auto_produce: true` on an order
 * item's metadata means an AUTOMATIC door must not create a run for it. It says
 * nothing about the EXPLICIT door — `createRunsForDesignOrder` is precisely the
 * admin saying "produce this now", and deliberately ignores the flag.
 *
 * Absence of the flag is not permission on its own; it just means this
 * particular veto was never cast.
 */
export const NO_AUTO_PRODUCE_METADATA_KEY = "no_auto_produce"

/**
 * True when the item carries an explicit no-auto-produce veto.
 *
 * Accepts the boolean `true` and the string `"true"`: metadata is JSONB and
 * round-trips through the admin UI, MCP tools and CSV-ish imports, any of which
 * can hand back a string. Everything else — `false`, `"false"`, `0`, `""`,
 * `null`, absent — is NOT a veto.
 */
export function isAutoProduceSuppressed(
  metadata?: Record<string, any> | null
): boolean {
  const raw = metadata?.[NO_AUTO_PRODUCE_METADATA_KEY]
  return raw === true || raw === "true"
}
