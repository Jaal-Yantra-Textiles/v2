/**
 * Starting a design order: who it is for, and which door to knock on.
 *
 * This decision lived inline in the Designs list page, which was fine while
 * that was the only place an order could be started from. It is now needed on
 * `/design-orders` too, and a rule that decides WHICH CUSTOMER a cart is
 * created for is the last thing that should exist in two hand-written copies —
 * the two would not stay identical, and the failure mode is a cart on the
 * wrong buyer rather than an error anyone would see.
 *
 * Pure, so the rule can be tested without a page.
 */

/** Only the part of a design these decisions read. */
export type DesignForOrder = {
  id: string
  customer_id?: string | null
}

export type DesignOrderTarget =
  | { ok: true; customer_id: string | null; design_ids: string[] }
  | { ok: false; error: { title: string; description: string } }

/**
 * Work out who a collated design order is for.
 *
 * 🔑 NO customer is an ORDINARY outcome, not a refusal (#1817). This used to
 * stop and tell the operator to "link a customer first" — for an order they
 * were creating precisely because there is not one yet. A design only carries
 * a customer when it was made for somebody; most are made for stock, from a
 * brief, or out of the assistant, so the refusal fired on the common case. The
 * draft is created with no buyer and acquires one at checkout.
 *
 * TWO customers is still refused: that is genuinely ambiguous, and a cart on
 * the WRONG buyer is worse than a cart on none.
 */
export const resolveDesignOrderTarget = (
  designs: DesignForOrder[]
): DesignOrderTarget => {
  if (!designs.length) {
    return {
      ok: false,
      error: {
        title: "Nothing selected",
        description: "Pick at least one design to collate into an order.",
      },
    }
  }

  const customerIds = Array.from(
    new Set(
      designs
        .map((d) => d.customer_id)
        // `""` is not a customer. Left unguarded it would count as a distinct
        // id and turn one real buyer into "multiple customers".
        .filter((id): id is string => Boolean(id && String(id).trim()))
    )
  )

  if (customerIds.length > 1) {
    return {
      ok: false,
      error: {
        title: "Multiple customers selected",
        description:
          "An order collates designs for a single customer. Select designs that all belong to the same customer.",
      },
    }
  }

  return {
    ok: true,
    customer_id: customerIds[0] ?? null,
    design_ids: designs.map((d) => d.id),
  }
}

/**
 * The two endpoints for a draft, given the buyer.
 *
 * There is a customer-less twin of each because most designs carry no customer
 * link. The estimate never depended on the buyer either — the customer route's
 * own handler ignores its `:id` — but with no customer there is no id to put
 * in a path, so the twin is what gets called.
 */
export const designOrderRoutes = (
  customerId: string | null
): { preview: string; create: string } =>
  customerId
    ? {
        preview: `/admin/customers/${customerId}/design-order/preview`,
        create: `/admin/customers/${customerId}/design-order`,
      }
    : {
        preview: `/admin/designs/draft-order/preview`,
        create: `/admin/designs/draft-order`,
      }

/**
 * The body both doors take. `price_overrides` is omitted rather than sent
 * empty: an empty object is a statement that every price was overridden to
 * nothing, and the route reads presence, not size.
 */
export const designOrderCreateBody = (input: {
  design_ids: string[]
  price_overrides?: Record<string, number>
  override_currency?: string
  /**
   * The currency the CART is created in (#2176 item 5).
   *
   * 🔴 Distinct from `override_currency`, which only says what any manual
   * prices are denominated in. Without this the create workflow falls through
   * to `input.currency_code || "inr"`, so every design order was INR — and a
   * European buyer was quoted in rupees and routed to PayU, the India region's
   * only payment provider.
   */
  currency_code?: string
}): Record<string, unknown> => {
  const overrides = input.price_overrides ?? {}
  return {
    design_ids: input.design_ids,
    price_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    override_currency: input.override_currency,
    currency_code: input.currency_code,
  }
}

/** Only the part of a customer these decisions read. */
export type BuyerForCurrency = {
  default_billing_address?: { country_code?: string | null } | null
  default_shipping_address?: { country_code?: string | null } | null
  addresses?: { country_code?: string | null }[] | null
}

/**
 * PURE: which country is this buyer in? (#2176)
 *
 * 🔴 NEVER `addresses[0]`. A customer with a home and a work address has two,
 * and row 0 is whichever the database returned first — the same read that put
 * Albania on every European checkout link (#2177) and made currency a lottery
 * across 13 tenants (#2051).
 *
 * The DEFAULT addresses are answers the customer gave; an unordered list is
 * not. So: billing, then shipping, then a single address (unambiguous by
 * definition), then null. Null is honest — the caller falls back to the
 * platform default and the operator can still choose.
 */
export const buyerCountry = (
  buyer: BuyerForCurrency | null | undefined
): string | null => {
  const norm = (v: unknown): string | null => {
    if (typeof v !== "string") return null
    const t = v.trim().toLowerCase()
    return t ? t : null
  }

  const preferred =
    norm(buyer?.default_billing_address?.country_code) ??
    norm(buyer?.default_shipping_address?.country_code)
  if (preferred) return preferred

  const all = (buyer?.addresses ?? []).map((a) => norm(a?.country_code)).filter(Boolean)
  const distinct = Array.from(new Set(all as string[]))
  // One address, or several that all agree, is not a guess. Two that disagree
  // is, and a guess about the buyer's country is a guess about their money.
  return distinct.length === 1 ? distinct[0] : null
}

export type RegionForCurrency = {
  currency_code?: string | null
  countries?: { iso_2?: string | null }[] | null
}

/**
 * PURE: the currency a buyer in this country should be quoted in (#2176).
 *
 * Every design order was INR because nothing chose — the wizard sent no
 * currency and the create workflow fell through to `"inr"`. A buyer in the EU
 * was quoted in rupees and routed to PayU, the India region's only payment
 * provider, which he could not pay with.
 *
 * 🔑 A SUGGESTION, not a decision. It seeds a control the operator can still
 * change, which is why returning null when nothing matches is safe: the
 * existing default stands and nothing silently becomes a currency nobody
 * chose.
 */
export const suggestCurrencyForCountry = (
  country: string | null | undefined,
  regions: RegionForCurrency[] | null | undefined
): string | null => {
  const want = typeof country === "string" ? country.trim().toLowerCase() : ""
  if (!want) return null

  for (const r of regions ?? []) {
    const code = String(r?.currency_code ?? "").trim().toLowerCase()
    if (!code) continue
    const covers = (r?.countries ?? []).some(
      (c) => String(c?.iso_2 ?? "").trim().toLowerCase() === want
    )
    if (covers) return code
  }
  return null
}
