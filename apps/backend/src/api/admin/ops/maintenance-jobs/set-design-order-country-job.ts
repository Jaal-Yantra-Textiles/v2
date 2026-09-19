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
 * Name the country a design-order cart is being bought from.
 *
 * ## Why a cart with no country is broken, not merely incomplete
 *
 * An admin-created design order collects no address — that happens at checkout.
 * So the cart names no country, and `resolveCartCheckoutLink` refuses to build
 * a link rather than guess one, because a link with no country segment lets the
 * storefront substitute its own default.
 *
 * 🔴 Watched happen in prod on 2026-09-19: `/se/checkout/cart/<id>` and
 * `/de/checkout/cart/<id>` BOTH redirected to `/al/checkout` — Albania — for a
 * Swedish buyer's EUR cart. The prefix in the URL is discarded; the storefront
 * re-resolves the region and takes `countries[0]`, and Albania is first in the
 * Europe region's list. So no hand-written link can work around it. The country
 * has to be ON THE CART.
 *
 * ## The one validation that matters
 *
 * ⚠️ The country must belong to the cart's OWN region. Setting one the region
 * does not serve leaves the storefront re-regioning exactly as before, while
 * this job reports success — the shape where a repair reads as done and changed
 * nothing observable.
 *
 * ## What it will not do
 *
 * Refuses a completed cart (it is an order's paper trail) and a cancelled one
 * (nobody should be sent to a checkout we withdrew). Sets ONLY `country_code`
 * — no invented street, city or postcode, because a fabricated address on a
 * real order is worse than an absent one; the buyer supplies the rest at
 * checkout.
 */

const ISO2 = /^[a-z]{2}$/

const paramsSchema = z.object({
  cart_id: z.string().trim().min(1),
  country_code: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => ISO2.test(v), {
      message: "country_code must be an ISO-2 code, e.g. 'se'",
    }),
})

export type CountryDecision =
  | { ok: true }
  | {
      ok: false
      reason: "completed" | "cancelled" | "not_in_region" | "already_set"
      message: string
    }

/**
 * PURE: may this cart be given this country?
 *
 * Exported and testable because every branch here is a refusal that protects a
 * real buyer, and the interesting cases (a country the region does not serve, a
 * cart already carrying a different one) are precisely the ones that are
 * awkward to reproduce against a live database.
 */
export const decideCountry = (input: {
  cart:
    | {
        completed_at?: string | Date | null
        metadata?: Record<string, unknown> | null
        shipping_address?: { country_code?: string | null } | null
      }
    | null
    | undefined
  country: string
  regionCountries: string[]
}): CountryDecision => {
  const { cart, country } = input

  if (cart?.completed_at) {
    return {
      ok: false,
      reason: "completed",
      message:
        "This cart is completed — it became an order and is that order's paper trail. Change the address on the order instead.",
    }
  }

  const cancelled = cart?.metadata?.cancelled_at
  if (typeof cancelled === "string" && cancelled.trim()) {
    return {
      ok: false,
      reason: "cancelled",
      message:
        "This design order was cancelled. Giving it a working checkout link would send a buyer to an order we withdrew.",
    }
  }

  const serves = (input.regionCountries ?? [])
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter(Boolean)

  if (!serves.includes(country)) {
    return {
      ok: false,
      reason: "not_in_region",
      message:
        `The cart's region does not serve "${country}". Setting it would leave the storefront re-regioning exactly as it does now, ` +
        `while this job reported success. Region serves: ${serves.join(", ") || "(none)"}.`,
    }
  }

  const current = String(cart?.shipping_address?.country_code ?? "")
    .trim()
    .toLowerCase()
  if (current === country) {
    return {
      ok: false,
      reason: "already_set",
      message: `The cart already names "${country}". Nothing to do.`,
    }
  }

  return { ok: true }
}

export const setDesignOrderCountryJob: MaintenanceJob = {
  id: "set-design-order-country",
  label: "Name the country a design-order cart is bought from",
  description:
    "Set `shipping_address.country_code` on a design-order cart so its checkout link resolves. An admin-created design order collects no address, so the cart names no country and resolveCartCheckoutLink refuses to build a link — and a hand-written one does NOT work: observed in prod, /se/ and /de/ checkout URLs both redirect to /al/ (Albania), because the storefront re-resolves the region and takes countries[0]. The country has to be on the cart. REFUSES a country the cart's own region does not serve (which would leave the storefront re-regioning while this reported success), a COMPLETED cart (it is an order's paper trail) and a CANCELLED one. Sets only the country code — no invented street or postcode; the buyer supplies the rest at checkout. Preview (default) shows the region's served countries and the exact before/after.",
  params: [
    {
      name: "cart_id",
      type: "string",
      required: true,
      description: "The design order's cart id (`cart_...`)",
    },
    {
      name: "country_code",
      type: "string",
      required: true,
      description: "ISO-2 country the buyer is purchasing from, e.g. 'se'",
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
    const { cart_id, country_code } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const cartService: any = container.resolve(Modules.CART)

    const { data: rows } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "metadata",
        "currency_code",
        "shipping_address.country_code",
        "region.id",
        "region.countries.iso_2",
      ],
      filters: { id: cart_id },
    })

    const cart = rows?.[0]
    if (!cart) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Cart ${cart_id} not found`
      )
    }

    const regionCountries = (cart.region?.countries ?? []).map(
      (c: any) => c?.iso_2
    )
    const decision = decideCountry({ cart, country: country_code, regionCountries })

    if (!decision.ok) {
      return {
        job_id: "set-design-order-country",
        dry_run,
        applied: false,
        summary: `REFUSED: ${decision.message}`,
        changes: [],
      }
    }

    const before = cart.shipping_address?.country_code ?? null

    const changes: MaintenanceChange[] = [
      {
        entity: "cart",
        id: cart_id,
        field: "shipping_address.country_code",
        before,
        after: country_code,
        note:
          `Region ${cart.region?.id} (${cart.currency_code}) serves ${regionCountries.length} countries. ` +
          `Without this the checkout link cannot be built, and a hand-written one is re-regioned to countries[0].`,
      },
    ]

    if (!dry_run) {
      await cartService.updateCarts(cart_id, {
        shipping_address: { country_code },
      })
    }

    return {
      job_id: "set-design-order-country",
      dry_run,
      applied: !dry_run,
      summary: dry_run
        ? `Would set ${cart_id} to "${country_code}" (was ${before ?? "unset"}). Read the cart back afterwards — the checkout link should stop being null.`
        : `Set ${cart_id} to "${country_code}" (was ${before ?? "unset"}). Read the cart back to confirm the checkout link now resolves.`,
      changes,
    }
  },
}
