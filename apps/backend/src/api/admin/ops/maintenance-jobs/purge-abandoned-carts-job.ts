import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — retire abandoned carts.
 *
 * ## Why this job exists
 *
 * Nothing on this platform could remove a cart. There is no admin cart DELETE
 * route, no MCP tool, and no job — so every cart ever opened is still there,
 * including the ones opened by a test run or by a shopper who closed the tab.
 * That was discovered the obvious way: verifying a storefront fix against
 * production created four guest carts and there was no way to clear them.
 *
 * A stray cart is not inert. `getOrSetCart` hands a returning visitor the cart
 * on their cookie, cart-recovery mail is aimed at abandoned carts, and the
 * abandoned-cart dashboards count them — so the test residue is indistinguishable
 * from a real lost sale in every one of those surfaces.
 *
 * ## SOFT delete, and the completed cart is untouchable
 *
 * `softDeleteCarts` — the row leaves every list and can be restored.
 *
 * A cart with `completed_at` is REFUSED outright, at any age, with or without
 * any flag. That cart became an order, and the order still points at it: it is
 * the paper trail for something a customer bought, not an abandoned basket.
 * There is deliberately no parameter to override that.
 *
 * ## What "abandoned" has to mean here
 *
 * Age alone is not enough, and defaulting to age alone is how a job like this
 * eats a real shopper's basket. The default selection is the narrow one:
 *
 *   · older than `older_than_days` (required — no default age, the operator
 *     must state it), AND
 *   · never completed, AND
 *   · no email AND no customer_id — nobody we could contact, which is also
 *     exactly what a scripted/test cart looks like.
 *
 * `include_identified=true` widens it to carts that DO carry an email or a
 * customer. Those are the ones cart-recovery mail is aimed at, so widening is a
 * decision about marketing, not housekeeping — hence a flag, and hence off.
 *
 * Idempotent: soft-deleted rows are not returned by the scan.
 */

/** Bounds one call's blast radius; bigger sweeps raise `limit` across calls. */
export const MAX_CART_PURGE = 1000

const paramsSchema = z.object({
  /**
   * Required, with no default. An age is the whole safety margin of this job,
   * and a default would let someone run it meaning "the obvious thing" and get
   * whatever number we happened to pick.
   */
  older_than_days: z.number().int().positive(),
  /**
   * Also purge carts that carry an email or a customer — the population
   * cart-recovery mail targets. Off by default.
   */
  include_identified: z.boolean().optional().default(false),
  /** Only purge carts with no line items. */
  empty_only: z.boolean().optional().default(false),
  /** Act on exactly these cart ids (still subject to every refusal). */
  cart_ids: z.array(z.string().min(1)).max(MAX_CART_PURGE).optional(),
  limit: z.number().int().positive().max(MAX_CART_PURGE).optional().default(200),
})

/** The cut-off instant: carts created strictly before this are old enough. */
export function computeCartCutoff(now: Date, olderThanDays: number): Date {
  return new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000)
}

type CartRow = {
  id: string
  email?: string | null
  customer_id?: string | null
  completed_at?: string | Date | null
  created_at?: string | Date | null
  items?: unknown[] | null
}

/**
 * Pure: why this cart must NOT be purged, or `null` if it may be.
 *
 * The whole selection rule, in one testable function. A job that deletes rows
 * should be arguable from its refusals rather than from reading its loop.
 */
export function cartSkipReason(
  cart: CartRow,
  opts: { cutoff: Date; includeIdentified: boolean; emptyOnly: boolean }
): string | null {
  if (cart.completed_at) {
    return "completed — this cart became an order and is its paper trail"
  }
  const created = cart.created_at ? new Date(cart.created_at) : null
  if (!created || Number.isNaN(created.getTime())) {
    return "no readable created_at — cannot establish its age"
  }
  if (created >= opts.cutoff) {
    return `created ${created.toISOString().slice(0, 10)} — newer than the cut-off`
  }
  if (!opts.includeIdentified && (cart.email || cart.customer_id)) {
    return "carries an email or customer — a recovery target (pass include_identified)"
  }
  if (opts.emptyOnly && (cart.items?.length ?? 0) > 0) {
    return `holds ${cart.items?.length} line item(s) and empty_only is set`
  }
  return null
}

const summarize = (dryRun: boolean, purged: number, skipped: number, days: number): string => {
  const verb = dryRun ? "Would retire" : "Retired"
  if (purged === 0 && skipped === 0) {
    return `No carts older than ${days} days matched.`
  }
  return (
    `${verb} ${purged} abandoned cart${purged === 1 ? "" : "s"} older than ` +
    `${days} days` + (skipped ? `; skipped ${skipped} (see notes).` : ".")
  )
}

export const purgeAbandonedCartsJob: MaintenanceJob = {
  id: "purge-abandoned-carts",
  label: "Retire abandoned carts",
  description:
    `Soft-delete carts older than 'older_than_days' that were never completed. By default only carts with NO email and NO customer are eligible — nobody to recover, which is also what a test cart looks like; set include_identified=true to widen to carts cart-recovery mail targets. A COMPLETED cart is refused at any age and there is no flag to override it: it became an order and is that order's paper trail. Preview (default) lists exactly which carts would go and why any were skipped. Purges up to 'limit' oldest per call (default 200, max ${MAX_CART_PURGE}).`,
  params: [
    {
      name: "older_than_days",
      type: "number",
      required: true,
      description: "Only carts created more than this many days ago",
    },
    {
      name: "include_identified",
      type: "boolean",
      required: false,
      description:
        "Also purge carts carrying an email or customer_id — cart-recovery targets (default false)",
    },
    {
      name: "empty_only",
      type: "boolean",
      required: false,
      description: "Only purge carts with no line items (default false)",
    },
    {
      name: "cart_ids",
      type: "string",
      required: false,
      description:
        "Comma-separated cart ids to act on instead of a sweep. Every refusal still applies.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max carts to purge in one call, oldest first (default 200, max ${MAX_CART_PURGE})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    // `cart_ids` arrives from the console as a comma-separated string and from
    // a scripted caller as an array. Normalise before validating so one shape
    // is not silently a 400 for the other.
    const raw = { ...params }
    if (typeof raw.cart_ids === "string") {
      raw.cart_ids = raw.cart_ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }

    const parsed = paramsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { older_than_days, include_identified, empty_only, cart_ids, limit } =
      parsed.data

    const cartService: any = container.resolve(Modules.CART)
    const cutoff = computeCartCutoff(new Date(), older_than_days)

    const filters: Record<string, unknown> = {}
    if (cart_ids?.length) filters.id = cart_ids

    const carts: CartRow[] = await cartService.listCarts(filters, {
      take: MAX_CART_PURGE,
      order: { created_at: "ASC" },
      relations: ["items"],
    })

    const changes: MaintenanceChange[] = []
    const toPurge: string[] = []
    let skipped = 0

    for (const cart of carts ?? []) {
      if (toPurge.length >= limit) break

      const reason = cartSkipReason(cart, {
        cutoff,
        includeIdentified: include_identified,
        emptyOnly: empty_only,
      })

      if (reason) {
        // Only narrate a skip for a cart the operator asked about by id, or one
        // refused for a reason other than simply being too new — otherwise a
        // sweep's notes are mostly "newer than the cut-off".
        if (cart_ids?.length || !reason.includes("newer than the cut-off")) {
          skipped += 1
          changes.push({
            entity: "cart",
            id: cart.id,
            field: "skipped",
            before: null,
            after: null,
            note: reason,
          })
        }
        continue
      }

      toPurge.push(cart.id)
      changes.push({
        entity: "cart",
        id: cart.id,
        field: "deleted_at",
        before: null,
        after: "soft-deleted",
        note:
          `created ${String(cart.created_at).slice(0, 10)}, never completed, ` +
          `${cart.items?.length ?? 0} line item(s), ` +
          `${cart.email || cart.customer_id ? "identified" : "no email or customer"}`,
      })
    }

    if (!dry_run && toPurge.length > 0) {
      await cartService.softDeleteCarts(toPurge)
    }

    return {
      job_id: purgeAbandonedCartsJob.id,
      dry_run,
      applied: !dry_run && toPurge.length > 0,
      summary: summarize(dry_run, toPurge.length, skipped, older_than_days),
      changes,
    }
  },
}
