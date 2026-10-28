import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { refreshDesignCartTax } from "../../../../workflows/designs/lib/refresh-design-cart-tax"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Recompute GST on an open design-order cart.
 *
 * Design-order carts minted before the fix were created with no tax lines, and
 * checkout only recomputes them when the buyer changes a tax-relevant address
 * field. A buyer who picks up in person changes nothing and pays with no GST —
 * prod order #148 (2026-10-27) charged ₹2,285.71 instead of ₹2,400.
 *
 * Refuses a completed cart (it is an order now — tax there is a credit line or
 * a payment collection, not a cart edit), a cancelled one, and a cart that is
 * not a design order (a storefront cart is the buyer's own and refreshes
 * itself). Preview (default) reads the cart's current tax.
 */

const paramsSchema = z.object({
  cart_id: z.string().trim().min(1),
})

export type RefreshTaxDecision =
  | { ok: true }
  | {
      ok: false
      reason: "completed" | "cancelled" | "not_design_order" | "no_country"
      message: string
    }

/** PURE: may this cart's tax be recomputed? */
export const decideRefreshTax = (
  cart:
    | {
        completed_at?: string | Date | null
        metadata?: Record<string, unknown> | null
        shipping_address?: { country_code?: string | null } | null
      }
    | null
    | undefined
): RefreshTaxDecision => {
  if (cart?.completed_at) {
    return {
      ok: false,
      reason: "completed",
      message:
        "This cart is completed — it is an order now. Settle the order's tax with a payment collection or credit line instead.",
    }
  }
  const cancelled = cart?.metadata?.cancelled_at
  if (typeof cancelled === "string" && cancelled.trim()) {
    return {
      ok: false,
      reason: "cancelled",
      message: "This design order was cancelled. Nothing to tax.",
    }
  }
  if (cart?.metadata?.source !== "design-order") {
    return {
      ok: false,
      reason: "not_design_order",
      message:
        "This is not a design-order cart. A storefront cart recomputes its own tax at checkout.",
    }
  }
  if (!String(cart?.shipping_address?.country_code ?? "").trim()) {
    return {
      ok: false,
      reason: "no_country",
      message:
        "The cart names no country, so no tax region applies. Run set-design-order-country first — it recomputes tax itself.",
    }
  }
  return { ok: true }
}

export const refreshDesignOrderCartTaxJob: MaintenanceJob = {
  id: "refresh-design-order-cart-tax",
  label: "Recompute GST on an open design-order cart",
  description:
    "Recompute tax lines on a design-order cart. Carts minted before the fix carry NO tax on the design line, and checkout only recomputes tax when the buyer changes their address — so an In Person Pickup buyer pays with no GST (prod #148: ₹2,285.71 charged, ₹0 GST). REFUSES a completed cart (it is an order), a cancelled one, a non-design-order cart and a cart with no country. Preview (default) shows the current tax; apply shows before/after.",
  params: [
    {
      name: "cart_id",
      type: "string",
      required: true,
      description: "The design order's cart id (`cart_...`)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { cart_id } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: rows } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "metadata",
        "currency_code",
        "tax_total",
        "total",
        "shipping_address.country_code",
      ],
      filters: { id: cart_id },
    })
    const cart = rows?.[0]
    if (!cart) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cart_id} not found`)
    }

    const decision = decideRefreshTax(cart)
    if (!decision.ok) {
      return {
        job_id: "refresh-design-order-cart-tax",
        dry_run,
        applied: false,
        summary: `REFUSED: ${decision.message}`,
        changes: [],
      }
    }

    const before = { tax_total: Number(cart.tax_total ?? 0), total: Number(cart.total ?? 0) }

    if (dry_run) {
      return {
        job_id: "refresh-design-order-cart-tax",
        dry_run,
        applied: false,
        summary:
          `Cart ${cart_id} (${cart.currency_code}, ${cart.shipping_address.country_code}) currently: ` +
          `tax ${before.tax_total}, total ${before.total}. Apply to recompute.`,
        changes: [
          {
            entity: "cart",
            id: cart_id,
            field: "tax_total",
            before: before.tax_total,
            after: "(recomputed on apply)",
          },
        ],
      }
    }

    const after = await refreshDesignCartTax(container, cart_id)
    const changes: MaintenanceChange[] = [
      { entity: "cart", id: cart_id, field: "tax_total", before: before.tax_total, after: after.tax_total },
      { entity: "cart", id: cart_id, field: "total", before: before.total, after: after.total },
    ]

    return {
      job_id: "refresh-design-order-cart-tax",
      dry_run,
      applied: true,
      summary: `Recomputed ${cart_id}: tax ${before.tax_total} → ${after.tax_total}, total ${before.total} → ${after.total} ${cart.currency_code}.`,
      changes,
    }
  },
}
