"use server"

import { revalidateTag } from "next/cache"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"

import { getAuthHeaders, getCacheOptions, getCacheTag } from "./cookies"
import { getOrSetCart } from "./cart"

/**
 * #1349 — the production spec on the storefront.
 *
 * Reading it is public and cacheable; ordering against it is not. The colour a
 * customer may choose is decided by the BACKEND against the partner's published
 * palette (`/store/carts/:id/made-to-spec`), never here — this file builds the
 * request, it does not get to decide what is orderable.
 */

export type StoreSpecColor = {
  id?: string
  name: string
  hex_code?: string | null
  usage_notes?: string | null
}

export type StoreSpecField = {
  key: string
  label?: string | null
  value?: string | null
}

export type StoreSpecOptionValue = {
  id?: string
  label: string
  note?: string | null
}

/**
 * A partner-defined choice on the spec — "Color Pattern", "Embroidery".
 *
 * `values` is already filtered to what is orderable by the read route, so an
 * empty `values` on a `required` group means the piece cannot be ordered right
 * now. The form says so rather than hiding the group, because a page that
 * silently drops a required axis looks orderable and is not.
 */
export type StoreSpecOption = {
  id?: string
  key: string
  label: string
  help_text?: string | null
  required: boolean
  values: StoreSpecOptionValue[]
}

export type StoreProductSpec = {
  id?: string
  weave_technique?: string | null
  weave_label?: string | null
  params?: Record<string, number> | null
  finishes?: string[]
  accepting_custom_orders?: boolean
  custom_order_lead_time_days?: number | null
  colors: StoreSpecColor[]
  fields: StoreSpecField[]
  options?: StoreSpecOption[]
}

export type StoreSpecTechnique = {
  slug: string
  label: string
  family: string
  description: string
  params: { key: string; label: string; unit: string }[]
}

export type StoreProductSpecResponse = {
  spec: StoreProductSpec | null
  technique: StoreSpecTechnique | null
}

/**
 * How long a cached spec may be stale.
 *
 * A spec is edited by a partner or an admin in another application entirely,
 * and nothing in this storefront is told when that happens: the tag below is
 * attached but NOTHING ANYWHERE revalidates it, and `getCacheTag` returns ""
 * for a visitor with no `_medusa_cache_id` cookie, so for most traffic there is
 * no tag to revalidate in the first place. Without a TTL, `force-cache` then
 * means what it says — the first response is served until the next deploy.
 *
 * That is not hypothetical: every product currently resolves to `spec: null`,
 * so the null is what gets pinned, and the first spec anyone publishes would
 * never appear. It is the same shape as the theme cache that served stale
 * storefront content until redeploy (#1338).
 *
 * Five minutes: a spec is edited rarely and read on every product page, so this
 * is still a cache hit essentially always, while an edit lands on its own
 * without anyone knowing to go and clear anything.
 */
const SPEC_CACHE_TTL_SECONDS = 300

/**
 * A product's spec, by id or handle.
 *
 * Most products have none, and that is not an error — an absent spec resolves
 * to `{ spec: null }` so a product page never fails over a block it was only
 * going to render conditionally.
 */
export const getProductSpec = async (
  idOrHandle: string
): Promise<StoreProductSpecResponse> => {
  const next = {
    ...(await getCacheOptions(`product-spec-${idOrHandle}`)),
    revalidate: SPEC_CACHE_TTL_SECONDS,
  }

  return sdk.client
    .fetch<StoreProductSpecResponse>(
      `/store/products/${encodeURIComponent(idOrHandle)}/spec`,
      { next, cache: "force-cache" }
    )
    .catch((e) => {
      // A failed read must still render the page — the spec block is optional.
      // But it must not be INDISTINGUISHABLE from "this product has no spec":
      // that is how a 500 gets read as a design decision and nobody looks.
      console.error(
        `[product-spec] Could not load the spec for ${idOrHandle}: ${
          e?.message ?? e
        }`
      )
      return { spec: null, technique: null }
    })
}

/**
 * Add a made-to-order piece to the cart.
 *
 * Posts the customer's colourway and note to the validating route, which
 * refuses anything the partner has not published and snapshots what it accepts
 * onto the line item. A rejection is surfaced verbatim — the backend's message
 * names the colours that ARE available, which is what the shopper needs.
 */
export async function addMadeToSpecToCart({
  variantId,
  quantity,
  color,
  note,
  options,
  countryCode,
}: {
  variantId: string
  quantity: number
  color?: string | null
  note?: string | null
  /** Option key → chosen value label, as published by the spec read. */
  options?: Record<string, string> | null
  countryCode: string
}) {
  if (!variantId) {
    throw new Error("Missing variant ID when ordering a made-to-order piece")
  }

  const cart = await getOrSetCart(countryCode)

  if (!cart) {
    throw new Error("Error retrieving or creating cart")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.client
    .fetch(`/store/carts/${cart.id}/made-to-spec`, {
      method: "POST",
      body: {
        variant_id: variantId,
        quantity,
        color: color || undefined,
        note: note || undefined,
        options:
          options && Object.keys(options).length ? options : undefined,
      },
      headers,
    })
    .catch(medusaError)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)

  const fulfillmentCacheTag = await getCacheTag("fulfillment")
  revalidateTag(fulfillmentCacheTag)
}
