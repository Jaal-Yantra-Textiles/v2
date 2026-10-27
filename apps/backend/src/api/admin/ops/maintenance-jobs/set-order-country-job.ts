import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Correct the country a PLACED order ships to.
 *
 * The sibling of `set-design-order-country`, for the moment after checkout.
 * That job refuses a completed cart and says "change the address on the order
 * instead" — but the order route cannot: Medusa's `updateOrderWorkflow`
 * answers `400 Country code cannot be changed`, so a converted design order
 * that inherited the wrong country had no door at all.
 *
 * 🔴 Watched in prod on 2026-10-27: order #123 (Kunal, Sweden) carried `in`
 * because the design order it was converted from was minted with India as the
 * country. The buyer lives in Sweden; the shipment is an export.
 *
 * ## What it will not do
 *
 * - Touch the region, currency, prices or tax lines. The order was paid in
 *   them, and re-pricing a paid order is an order edit, not a data repair. The
 *   change set says so, so nobody reads "country fixed" as "tax fixed".
 * - Correct an order that has a fulfillment. A label booked to the old country
 *   is already with a carrier; changing the address under it makes the record
 *   disagree with the parcel. Cancel the fulfillment first.
 * - Correct a cancelled order, or invent a street or postcode — only the
 *   country code moves.
 */

const ISO2 = /^[a-z]{2}$/

const paramsSchema = z.object({
  order_id: z.string().trim().min(1),
  country_code: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => ISO2.test(v), {
      message: "country_code must be an ISO-2 code, e.g. 'se'",
    }),
})

export type OrderCountryDecision =
  | { ok: true }
  | {
      ok: false
      reason: "cancelled" | "no_address" | "fulfilled" | "already_set"
      message: string
    }

/**
 * PURE: may this order's shipping country be changed to `country`?
 *
 * `fulfillments` is the count of LIVE (not cancelled) fulfillments; the caller
 * filters, so the rule here stays a rule and not a query.
 */
export const decideOrderCountry = (input: {
  order:
    | {
        status?: string | null
        canceled_at?: string | Date | null
        shipping_address?: { id?: string | null; country_code?: string | null } | null
      }
    | null
    | undefined
  liveFulfillments: number
  country: string
}): OrderCountryDecision => {
  const { order, country } = input

  if (order?.status === "canceled" || order?.canceled_at) {
    return {
      ok: false,
      reason: "cancelled",
      message: "This order is cancelled. There is no shipment to correct.",
    }
  }

  if (!order?.shipping_address?.id) {
    return {
      ok: false,
      reason: "no_address",
      message:
        "This order has no shipping address row to correct. Add the address on the order instead.",
    }
  }

  if (input.liveFulfillments > 0) {
    return {
      ok: false,
      reason: "fulfilled",
      message:
        `This order has ${input.liveFulfillments} live fulfillment(s), booked to the current address. ` +
        "Cancel the fulfillment first, or the record will disagree with the parcel.",
    }
  }

  const current = String(order.shipping_address.country_code ?? "")
    .trim()
    .toLowerCase()
  if (current === country) {
    return {
      ok: false,
      reason: "already_set",
      message: `The order already ships to "${country}". Nothing to do.`,
    }
  }

  return { ok: true }
}

export const setOrderCountryJob: MaintenanceJob = {
  id: "set-order-country",
  label: "Correct the country a placed order ships to",
  description:
    "Change `shipping_address.country_code` on a PLACED order — the case the order route refuses with `Country code cannot be changed`, and that set-design-order-country cannot reach because the cart is completed. Typical cause: a design order minted with the wrong country and then converted. Changes ONLY the country code: region, currency, prices and tax lines are left as paid (re-pricing a paid order is an order edit). REFUSES a cancelled order, an order with no shipping address row, and an order with a live fulfillment (its label is booked to the old address — cancel it first). Preview (default) shows the before/after and the order's region, so a country outside it is visible rather than silent.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: true,
      description: "The order id (`order_...`)",
    },
    {
      name: "country_code",
      type: "string",
      required: true,
      description: "ISO-2 country the order actually ships to, e.g. 'se'",
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
    const { order_id, country_code } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderService: any = container.resolve(Modules.ORDER)

    const { data: rows } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "status",
        "canceled_at",
        "currency_code",
        "region_id",
        "shipping_address.id",
        "shipping_address.country_code",
        "fulfillments.id",
        "fulfillments.canceled_at",
      ],
      filters: { id: order_id },
    })

    const order = rows?.[0]
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Order ${order_id} not found`
      )
    }

    const liveFulfillments = (order.fulfillments ?? []).filter(
      (f: any) => f && !f.canceled_at
    ).length

    const decision = decideOrderCountry({
      order,
      liveFulfillments,
      country: country_code,
    })

    if (!decision.ok) {
      return {
        job_id: "set-order-country",
        dry_run,
        applied: false,
        summary: `REFUSED: ${decision.message}`,
        changes: [],
      }
    }

    const addressId = order.shipping_address.id
    const before = order.shipping_address.country_code ?? null

    const changes: MaintenanceChange[] = [
      {
        entity: "order_address",
        id: addressId,
        field: "country_code",
        before,
        after: country_code,
        note:
          `Order #${order.display_id ?? order_id}. Region ${order.region_id} and currency ${order.currency_code} are NOT changed, ` +
          "and neither are its prices or tax lines — they stay as paid.",
      },
    ]

    if (!dry_run) {
      await orderService.updateOrderAddresses([
        { id: addressId, country_code },
      ])
    }

    return {
      job_id: "set-order-country",
      dry_run,
      applied: !dry_run,
      summary: dry_run
        ? `Would change order ${order_id} to ship to "${country_code}" (was ${before ?? "unset"}). Region, currency and tax unchanged.`
        : `Changed order ${order_id} to ship to "${country_code}" (was ${before ?? "unset"}). Read the order back to confirm.`,
      changes,
    }
  },
}
