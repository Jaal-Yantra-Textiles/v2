import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import {
  getProductionRunForLineItem,
  resolveLineItemDesignId,
} from "../../lib/resolve-line-item-production"
import { repointOrderItemDesign } from "./link-designs-to-order-items"
import { sendDesignOrderChangedEmailWorkflow } from "../email/workflows/send-design-order-changed-email"
import {
  buildDesignChangeNotice,
  type DesignChange,
  nextItemMetadata,
  type DesignChangeNotice,
} from "./lib/design-change-notice"

/**
 * #1918 — attach or detach the design behind an order line item, and tell the
 * customer what changed.
 *
 * `repointOrderItemDesign` has existed since #1919 and had ZERO callers: the
 * mechanism was built and no door was ever opened onto it. This is that door.
 *
 * ## Why the notice is computed BEFORE the write
 *
 * The previous design and the production run have to be read while the link
 * still points at them. Reading afterwards would report the new state as though
 * it were the old one, and the email would tell the customer nothing changed.
 *
 * ## Why the email is best-effort and the write is not
 *
 * The link write is the operation the admin asked for; the email is a courtesy
 * about it. A notification provider being down must not leave the order
 * pointing at the wrong design — so the write is committed first and a failed
 * send is reported in the result rather than thrown. The reverse ordering would
 * make the customer's inbox authoritative over the order.
 */

export type ChangeOrderItemDesignInput = {
  line_item_id: string
  /** The design to point the item at. `null` DETACHES it. */
  design_id: string | null
  /** Skip the customer email — for a correction the customer should not see. */
  notify?: boolean
  dry_run?: boolean
}

export type ChangeOrderItemDesignResult = {
  line_item_id: string
  action: "attached" | "detached" | "replaced" | "unchanged"
  previous_design_id: string | null
  /** Where the previous design came from: "link" (movable) or "metadata" (provenance only). */
  previous_design_source: string | null
  new_design_id: string | null
  removed_links: number
  created_link: boolean
  /** Whether `metadata.design_id` was brought into step with the link. */
  metadata_updated: boolean
  notice: DesignChangeNotice
  email: { sent: boolean; to: string | null; reason?: string }
  dry_run: boolean
}

/** One line's move, inside a batch. */
export type DesignChangeRequest = {
  line_item_id: string
  /** The design to point the item at. `null` DETACHES it. */
  design_id: string | null
}

export type ChangeOrderDesignsInput = {
  changes: DesignChangeRequest[]
  /**
   * The order these lines must belong to. Checked BEFORE anything is written,
   * so a caller addressing the wrong order is refused rather than half-applied.
   */
  order_id?: string
  /** Skip the customer email — for a correction the customer should not see. */
  notify?: boolean
  dry_run?: boolean
}

/** What happened to one line. The email is reported once, for the batch. */
export type ChangedItemResult = Omit<
  ChangeOrderItemDesignResult,
  "notice" | "email" | "dry_run"
>

export type ChangeOrderDesignsResult = {
  order_id: string | null
  display_id: number | null
  items: ChangedItemResult[]
  /** ONE notice covering every line in this change. */
  notice: DesignChangeNotice
  /** ONE email for the whole change — not one per line. */
  email: { sent: boolean; to: string | null; reason?: string }
  dry_run: boolean
}

/**
 * Read the design the item currently stands for, and WHERE that came from.
 *
 * Uses `resolveLineItemDesignId` rather than reading the link directly, because
 * an item can carry a design without carrying a LINK: anything predating the
 * #1919 backfill has only `metadata.design_id`. Reading the link alone reports
 * such an item as design-less, and the email would then tell the customer a
 * garment was "attached" when it was really re-pointed — losing the fact that
 * something was there before.
 *
 * `source` is carried out to the caller because it changes what the write
 * means: from `"link"` this is a move, from `"metadata"` it is the first link
 * this item has ever had.
 */
async function readCurrentDesign(
  query: any,
  lineItemId: string,
  item: { product_id?: string | null; variant_id?: string | null; metadata?: any }
): Promise<{ id: string; name: string | null; source: string | null } | null> {
  const resolved = await resolveLineItemDesignId(query, {
    productId: item?.product_id ?? null,
    variantId: item?.variant_id ?? null,
    lineItemId,
    metadata: item?.metadata ?? null,
  })
  if (!resolved.designId) return null

  const { data: designs } = await query.graph({
    entity: "design",
    fields: ["id", "name"],
    filters: { id: resolved.designId },
  })
  return {
    id: resolved.designId,
    name: designs?.[0]?.name ?? null,
    source: resolved.source,
  }
}

/** The order this item belongs to, with the customer's email and the title. */
async function readItemContext(
  query: any,
  lineItemId: string
): Promise<{
  order_id: string | null
  item: any | null
  item_title: string | null
  display_id: number | null
  email: string | null
  customer_first_name: string | null
} | null> {
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "customer.first_name",
      // Same chain the order-placed email uses. `customer.first_name` alone is
      // null for a guest order and for a customer record with no name, and
      // Handlebars renders that as "Hi ," without complaining.
      "shipping_address.first_name",
      "billing_address.first_name",
      "items.id",
      "items.title",
      "items.product_id",
      "items.variant_id",
      "items.metadata",
    ],
    filters: { items: { id: lineItemId } },
  })
  const order = orders?.[0]
  if (!order) return null
  const item = (order.items || []).find((i: any) => String(i.id) === lineItemId)
  return {
    order_id: order.id ?? null,
    item: item ?? null,
    item_title: item?.title ?? null,
    display_id: order.display_id ?? null,
    email: order.email ?? null,
    customer_first_name:
      order.customer?.first_name ||
      order.shipping_address?.first_name ||
      order.billing_address?.first_name ||
      (order.email ? String(order.email).split("@")[0] : null) ||
      "there",
  }
}

/**
 * Everything ONE line's change depends on, read while the link still points at
 * the OLD design. Reading after the write would report the new state as though
 * it were the old one, and the email would tell the customer nothing changed.
 */
async function readChange(
  query: any,
  req: DesignChangeRequest
): Promise<{
  ctx: Awaited<ReturnType<typeof readItemContext>>
  change: DesignChange
  previousSource: string | null
}> {
  const lineItemId = req.line_item_id

  // Context first: the design resolver needs the item's product/variant/metadata,
  // so this one read cannot be parallelised with the other two.
  const ctx = await readItemContext(query, lineItemId)
  const [previous, run] = await Promise.all([
    readCurrentDesign(query, lineItemId, ctx?.item ?? {}),
    getProductionRunForLineItem(query, lineItemId),
  ])

  let next: { id: string; name: string | null } | null = null
  if (req.design_id) {
    const { data: designs } = await query.graph({
      entity: "design",
      fields: ["id", "name"],
      filters: { id: req.design_id },
    })
    if (!designs?.length) {
      throw new Error(`Design ${req.design_id} does not exist`)
    }
    next = { id: String(designs[0].id), name: designs[0].name ?? null }
  }

  return {
    ctx,
    previousSource: previous?.source ?? null,
    change: {
      line_item_id: lineItemId,
      item_title: ctx?.item_title ?? null,
      previous_design: previous,
      new_design: next,
      run,
    },
  }
}

/** Move ONE line's design. Says nothing to the customer — that is the batch's job. */
async function writeChange(
  container: MedusaContainer,
  logger: any,
  read: Awaited<ReturnType<typeof readChange>>,
  action: ChangedItemResult["action"],
  dryRun: boolean
): Promise<ChangedItemResult> {
  const lineItemId = read.change.line_item_id
  const designId = read.change.new_design?.id ?? null

  const { removed, created } = await repointOrderItemDesign(
    container,
    lineItemId,
    designId,
    { dryRun }
  )

  /**
   * Keep `metadata.design_id` in step with the link (founder decision,
   * 2026-09-09).
   *
   * #1919 froze this string as pure provenance and made the link the answer.
   * That left the two disagreeing after a re-point — and `metadata.design_id`
   * is still read over HTTP by partner-ui, which cannot be migrated yet. So a
   * re-point that did not write it would move the design everywhere EXCEPT the
   * surface a partner actually looks at.
   *
   * 🔴 The original is preserved once, under `original_design_id`, before the
   * first overwrite. Losing what an item was ORDERED as is irreversible, and
   * the whole reason #1918 could be diagnosed at all was that the string still
   * said what the order originally meant. Written only when absent, so repeated
   * re-points keep the FIRST value rather than the previous one.
   */
  let metadataUpdated = false
  if (!dryRun && action !== "unchanged") {
    try {
      const orderService: any = container.resolve(Modules.ORDER)
      const nextMeta = nextItemMetadata(
        read.ctx?.item?.metadata as Record<string, any> | null,
        designId
      )

      await orderService.updateOrderLineItems(lineItemId, { metadata: nextMeta })
      metadataUpdated = true
    } catch (e: any) {
      // Reported, not thrown: the LINK is authoritative and is already
      // committed. A failed metadata sync leaves the two disagreeing, which is
      // exactly the state #1919 built the link to survive.
      logger?.warn?.(
        `[design-change] link re-pointed on ${lineItemId} but metadata.design_id sync failed: ${e?.message ?? e}`
      )
    }
  }

  return {
    line_item_id: lineItemId,
    action,
    previous_design_id: read.change.previous_design?.id ?? null,
    previous_design_source: read.previousSource,
    new_design_id: designId,
    removed_links: removed,
    created_link: created,
    metadata_updated: metadataUpdated,
  }
}

/**
 * Change the designs on an order — ONE change, ONE email.
 *
 * This is the shape Medusa itself uses for an order edit: actions accumulate
 * on a single order change and exactly one `order-edit.confirmed` event is
 * emitted when it is applied, no matter how many lines moved. Re-pointing
 * three designs one call at a time sent the customer three separate emails
 * about one decision.
 *
 * `buildDesignChangeNotice` was always built for this — it takes an ARRAY, and
 * its headline deliberately weakens to the worst-off garment across the whole
 * set ("they're all already in hand" only when every one of them is). Only the
 * caller was ever per-item.
 *
 * ## Order of operations
 *
 * Every line is READ first, and the batch is refused before any write if the
 * lines do not all belong to one order — one email addresses one customer
 * about one order, so a batch spanning two is a caller mistake, not something
 * to half-apply.
 *
 * Writes are then sequential and NOT transactional: link writes have no shared
 * transaction here. A failure part-way leaves the earlier lines moved, so the
 * error carries how many were applied rather than pretending nothing happened.
 */
export async function changeOrderDesigns(
  container: MedusaContainer,
  input: ChangeOrderDesignsInput
): Promise<ChangeOrderDesignsResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const dryRun = Boolean(input.dry_run)
  const requests = input.changes ?? []

  if (!requests.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No changes supplied — send at least one line to change."
    )
  }

  const seen = new Set<string>()
  for (const req of requests) {
    if (!req?.line_item_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Every change needs a line_item_id."
      )
    }
    if (seen.has(req.line_item_id)) {
      // Two moves of one line in a single change is ambiguous — the second
      // would silently win, and the customer would be told about both.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Line item ${req.line_item_id} appears twice in the same change.`
      )
    }
    seen.add(req.line_item_id)
  }

  // ── Read every line BEFORE touching any of them ──────────────────────────
  const reads = await Promise.all(requests.map((req) => readChange(query, req)))

  const orderIds = [
    ...new Set(reads.map((r) => r.ctx?.order_id).filter(Boolean)),
  ] as string[]
  if (orderIds.length > 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `These line items belong to ${orderIds.length} different orders. One change covers one order.`
    )
  }
  if (input.order_id && orderIds[0] && orderIds[0] !== input.order_id) {
    // Before the write, deliberately: applied first, this would move designs on
    // whichever order the lines DO belong to and report the mistake afterwards.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Those line items belong to order ${orderIds[0]}, not ${input.order_id}.`
    )
  }

  const notice = buildDesignChangeNotice(reads.map((r) => r.change))
  const ctx = reads[0]?.ctx ?? null

  // ── Write ────────────────────────────────────────────────────────────────
  const items: ChangedItemResult[] = []
  for (let i = 0; i < reads.length; i++) {
    try {
      items.push(
        await writeChange(
          container,
          logger,
          reads[i],
          notice.lines[i].action,
          dryRun
        )
      )
    } catch (e: any) {
      throw new Error(
        `Changed ${items.length} of ${reads.length} lines, then failed on ${reads[i].change.line_item_id}: ${e?.message ?? e}`
      )
    }
  }

  // ── Tell the customer ONCE, about the whole change ───────────────────────
  const wantsEmail = input.notify !== false && notice.should_send && !dryRun
  const email: ChangeOrderDesignsResult["email"] = {
    sent: false,
    to: ctx?.email ?? null,
  }
  if (!wantsEmail) {
    email.reason = dryRun
      ? "dry run"
      : input.notify === false
        ? "notify disabled"
        : "nothing changed"
  } else if (!ctx?.email) {
    // Reported, not thrown: an order with no email is a data gap, not a reason
    // to refuse the re-point the admin asked for.
    email.reason = "order has no email address"
  } else {
    try {
      /**
       * Through the workflow, so the DB template is FETCHED AND RENDERED.
       *
       * 🔴 This used to call `createNotifications` with the template key
       * alone. The provider needs `_template_html_content` on the payload;
       * without it it falls back to a generic "Notification from Jaal Yantra
       * Textiles" shell and reports success. The row was written and
       * `email.sent` was true, so nothing here and no test could tell that the
       * customer never received the sentence the confirm dialog quoted.
       *
       * `order_display_id` is passed alongside `display_id`: the template
       * declares the former, and a key the template does not know renders as
       * an empty string with no error.
       */
      await sendDesignOrderChangedEmailWorkflow(container).run({
        input: {
          to: ctx.email,
          data: {
            order_id: ctx.order_id,
            display_id: ctx.display_id,
            order_display_id: ctx.display_id,
            customer_first_name: ctx.customer_first_name,
            headline: notice.headline,
            all_in_hand: notice.all_in_hand,
            any_not_started: notice.any_not_started,
            lines: notice.changed_lines,
            current_year: new Date().getFullYear(),
          },
        },
      })
      email.sent = true
    } catch (e: any) {
      email.reason = `send failed: ${e?.message ?? String(e)}`
      logger?.warn?.(
        `[design-change] ${items.length} line(s) re-pointed on order ${ctx.order_id} but email failed: ${email.reason}`
      )
    }
  }

  return {
    order_id: ctx?.order_id ?? null,
    display_id: ctx?.display_id ?? null,
    items,
    notice,
    email,
    dry_run: dryRun,
  }
}

/**
 * One line, one email — a batch of exactly one.
 *
 * Kept as its own door because the MCP tool, the admin route and everything
 * written against #1918 address a single line item. It is now a thin wrapper:
 * there is one implementation of what a design change means, so the single and
 * batch paths cannot drift.
 */
export async function changeOrderItemDesign(
  container: MedusaContainer,
  input: ChangeOrderItemDesignInput
): Promise<ChangeOrderItemDesignResult> {
  const result = await changeOrderDesigns(container, {
    changes: [
      { line_item_id: input.line_item_id, design_id: input.design_id },
    ],
    notify: input.notify,
    dry_run: input.dry_run,
  })

  const item = result.items[0]
  return {
    ...item,
    notice: result.notice,
    email: result.email,
    dry_run: result.dry_run,
  }
}
