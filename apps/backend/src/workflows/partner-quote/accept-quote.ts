import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  createCartWorkflow,
  createShippingOptionsWorkflow,
  deleteShippingOptionsWorkflow,
  emitEventStep,
} from "@medusajs/medusa/core-flows"

import {
  QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE,
  QUOTE_FREIGHT_OPTION_TYPE_CODE,
  quoteFreightOptionName,
} from "../../modules/partner-quote/lib/quote-freight-option"
import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import { PARTNER_QUOTE_EVENTS } from "../../modules/partner-quote/events"
import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { quoteUnusableReason } from "../../modules/partner-quote/lib/token"
import { buildQuoteView } from "../../modules/partner-quote/lib/build-quote-view"

/**
 * Accepting a quote (#1439 S11).
 *
 * Turns a frozen quote into a cart the buyer can pay a deposit on. Four things
 * have to be true when this finishes, and each one has a step that refuses
 * rather than a comment that hopes:
 *
 * 1. **The cart belongs to the buyer the quote was priced for.** The minted
 *    price list is ruled on that buyer's customer group, so a cart with no
 *    customer prices every line at BASE and the entire quote silently
 *    evaporates. `customer_id` is therefore set from the quote at creation
 *    time — before the first line is added — never from anything the caller
 *    sends.
 * 2. **The cart charges the freight the quote froze.** See
 *    `createQuoteFreightOptionStep`: core will not accept an amount from a
 *    caller, so the frozen number is minted as a flat shipping option scoped to
 *    this one quote.
 * 3. **The cart's numbers equal the quote's numbers.** Asserted, not assumed.
 *    A 200 from cart creation proves a cart exists; it says nothing about what
 *    it costs. Every wrong number this epic has produced was produced
 *    successfully.
 * 4. **What is still owed is written down.** A `payment_schedule` row, keyed on
 *    the cart, splitting the total into a deposit and a balance.
 *
 * Idempotent by the quote's `accepted_cart_id`: a buyer who double-submits gets
 * the same cart back, not a second one priced against the same price list.
 */

export type AcceptQuoteInput = {
  quote_id: string
  /**
   * Where the goods go. Optional — a quote already carries a destination
   * country, postal code and city, which is what the freight was rated
   * against. Anything passed here is merged over that, so a buyer can supply
   * street-level detail at acceptance without being able to move the shipment
   * to a country the quote was never priced for.
   */
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    province?: string | null
    phone?: string | null
  } | null
  /**
   * Proceed even though the cart's tax does not match the tax the quote froze.
   *
   * 🔴 Off by default, and it should stay that way. Quote tax is resolved
   * against the SELLER's jurisdiction (#1447 — quoting an Indian export at 19%
   * German VAT lost deals silently), while a cart is taxed by core against the
   * cart's own region. When those disagree, the buyer is about to be charged
   * something other than what they were promised, and the honest response is to
   * stop. The escape hatch exists so an operator can take a deal through
   * knowingly, and it is recorded on the schedule when they do.
   */
  allow_tax_divergence?: boolean
  /**
   * The basket as the buyer actually dialled it (#1439 S13).
   *
   * The quote page has always let a buyer move quantities — `GET
   * /store/b2b/quotes/:token?lines=` re-prices the whole view through them —
   * but acceptance ignored this entirely and built the cart from the QUOTED
   * quantities. A buyer who dialled 40 up from 29, saw the new total, and
   * pressed accept got a cart for 29. Nothing anywhere said so.
   *
   * 🔑 Only quantities move. A variant not already on the quote is refused: the
   * price list was minted for THIS basket, and a line nobody quoted has no
   * frozen price to stand behind.
   */
  dialled_lines?: Array<{ variant_id: string; quantity: number }> | null
  /** Injected so acceptance is deterministic under test. */
  now?: Date
}

/** Money comparisons are in major units; a hundredth is the smallest unit that exists. */
const MONEY_EPSILON = 0.01

const near = (a: number, b: number): boolean => Math.abs(a - b) <= MONEY_EPSILON

/**
 * Load the quote and refuse everything that cannot become a cart.
 *
 * The refusals are all of the same kind: a quote that is not currently on offer
 * must not become an order. A revoked or superseded quote has had its price
 * list expired, so it would price at base — the failure would be a silently
 * cheaper (or dearer) cart rather than an error.
 */
const loadQuoteForAcceptStep = createStep(
  "load-quote-for-accept-step",
  async (
    input: {
      quote_id: string
      now: Date
      dialled_lines?: AcceptQuoteInput["dialled_lines"]
    },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const quote = await service.retrievePartnerQuote(input.quote_id).catch(() => null)
    if (!quote) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Quote not found")
    }

    // 🔑 BOTH, not just the cart id. `accepted_cart_id` is written early now,
    // so the freight option can be seen by the cart that earned it (see
    // `linkQuoteCartStep`); `accepted_at` is what says the acceptance actually
    // finished. Reading the pointer alone would make a half-finished run look
    // like a completed one and hand the buyer a cart with no freight.
    if (quote.accepted_cart_id && quote.accepted_at) {
      // Idempotent: this is a repeat submit, not a second deal.
      return new StepResponse({ quote, lines: [], store: null, dialled: false, existing_cart_id: quote.accepted_cart_id })
    }

    // The same reason the buyer's own page renders, from the same helper —
    // revoked, superseded, expired. Two implementations of "is this quote still
    // on offer?" is one more than can stay in agreement.
    const unusable = quoteUnusableReason(quote, input.now)
    if (unusable) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        unusable === "superseded"
          ? "A newer quote has replaced this one — accept that one instead."
          : `This quote is ${unusable} and can no longer be accepted.`
      )
    }
    // Without these three the cart cannot be the quote's cart: no customer means
    // base prices, no price list means nothing to price against.
    if (!quote.customer_id || !quote.customer_group_id || !quote.price_list_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Quote ${quote.id} predates buyer-scoped pricing and cannot be accepted; re-mint it`
      )
    }

    const quotedLines = await service.listPartnerQuoteLines({ quote_id: quote.id } as any)
    if (!quotedLines?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Quote ${quote.id} has no lines`
      )
    }

    /**
     * Apply the buyer's dial (#1439 S13), refusing anything that is not purely
     * a quantity change.
     *
     * 🔴 The variant allowlist is the security boundary, not a nicety. The
     * minted price list is scoped to this buyer's group and priced for THIS
     * basket; a variant nobody quoted has no frozen price behind it, so
     * accepting one would build a cart at whatever the catalogue happens to
     * say — a price this buyer was never offered and nobody agreed.
     *
     * A quantity of 0 removes the line rather than erroring: a buyer taking one
     * product out of a multi-line quote is an ordinary thing to do, and the
     * remaining lines are still priced by the same list.
     */
    const dial = new Map(
      (input.dialled_lines ?? [])
        .filter((l) => l && typeof l.variant_id === "string")
        .map((l) => [l.variant_id, Number(l.quantity)])
    )

    if (dial.size) {
      const quoted = new Set(quotedLines.map((l: any) => l.variant_id))
      for (const [variantId, quantity] of dial) {
        if (!quoted.has(variantId)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Variant ${variantId} is not on this quote, so it has no quoted price and cannot be added at acceptance.`
          )
        }
        if (!Number.isInteger(quantity) || quantity < 0) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Quantity for ${variantId} must be a whole number of units, not ${quantity}.`
          )
        }
      }
    }

    const lines = quotedLines
      .map((l: any) =>
        dial.has(l.variant_id)
          ? { ...l, quantity: dial.get(l.variant_id) }
          : l
      )
      .filter((l: any) => Number(l.quantity) > 0)

    if (!lines.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Every line was dialled to zero, so there is nothing to order."
      )
    }

    /**
     * Whether the basket actually moved. Carried so the totals check knows the
     * frozen columns no longer describe what is being bought — see
     * `assertCartMatchesQuoteStep`.
     */
    const dialled = lines.some(
      (l: any, i: number) =>
        Number(l.quantity) !== Number(quotedLines[i]?.quantity)
    ) || lines.length !== quotedLines.length

    // 🔑 Filtered by id, never a bare list. `filters: { id: undefined }` is NO
    // filter (#1433) — the same read on the public quote page once collected
    // every tenant's stock locations.
    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "default_sales_channel_id", "default_location_id", "default_region_id"],
      filters: { id: quote.store_id },
    })
    const store = (stores ?? [])[0] as any
    if (!store?.default_sales_channel_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Store ${quote.store_id} has no default sales channel; the cart would have no fulfilment set to ship from`
      )
    }

    return new StepResponse({ quote, lines, store, dialled, existing_cart_id: null })
  }
)

/**
 * Mint the flat shipping option that carries the frozen freight.
 *
 * 🔴 This exists because core owns the number. `addShippingMethodToCart` reads
 * the amount off `shippingOption.calculated_price`, and
 * `refreshCartShippingMethodsWorkflow` rewrites every method's amount from its
 * option on each cart refresh — deleting the method when the option no longer
 * prices. So writing an amount onto a shipping method survives exactly until
 * the buyer edits their address, and then the freight silently changes or
 * disappears. Handing core a priced option is the only way the frozen number
 * stays frozen.
 *
 * The option is built in the SAME service zone and shipping profile as the
 * option the quote was rated against, so it is available for the lane the quote
 * was priced for rather than for whichever zone a fresh lookup happens to find.
 *
 * It carries a `quote_id` rule so it is invisible to every other cart — see
 * `hooks/quote-shipping-options-context.ts`.
 */
const createQuoteFreightOptionStep = createStep(
  "create-quote-freight-option-step",
  async (
    input: { quote: any },
    { container }
  ) => {
    const quote = input.quote
    const freight = Number(quote.quoted_freight ?? 0)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    if (!quote.quoted_shipping_option_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Quote ${quote.id} did not freeze the shipping option its freight came from, ` +
          `so the accepted cart has no lane to charge it on. Re-mint the quote.`
      )
    }

    const { data: options } = await query.graph({
      entity: "shipping_options",
      fields: ["id", "name", "service_zone_id", "shipping_profile_id", "provider_id"],
      filters: { id: quote.quoted_shipping_option_id },
    })
    const source = (options ?? [])[0] as any
    if (!source) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The shipping option this quote was rated against (${quote.quoted_shipping_option_id}) no longer exists`
      )
    }

    const { result } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          // 🔑 Constructed in ONE place: `revokeQuote`'s teardown finds this
          // option by this exact string, so the two must not be able to drift
          // (#1527). A teardown that matches nothing fails silently.
          name: quoteFreightOptionName(quote.id),
          service_zone_id: source.service_zone_id,
          shipping_profile_id: source.shipping_profile_id,
          provider_id: source.provider_id,
          price_type: "flat",
          type: {
            label: "Quoted freight",
            description: "The freight this buyer was quoted, frozen at mint",
            // NOT "return" — the return option outbid the real one on every
            // domestic lane in #1485, and the picker now refuses anything whose
            // type code says return. Naming this one carefully keeps it out of
            // that blast radius.
            //
            // ⚠️ Careful naming was NOT enough. This option was still offered
            // to unrelated quotes, because the estimate reads options straight
            // out of `query.graph` and evaluates no rules — the `quote_id`
            // rule below hides it from other CARTS only. `isQuotableShippingOption`
            // now refuses this type code and this rule attribute outright
            // (#1527).
            code: QUOTE_FREIGHT_OPTION_TYPE_CODE,
          },
          prices: [{ currency_code: quote.currency_code, amount: freight }],
          rules: [
            {
              attribute: QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE,
              operator: "eq",
              value: String(quote.id),
            },
          ],
        } as any,
      ],
    })

    const option = (result as any[])?.[0]
    return new StepResponse(
      { shipping_option_id: option.id },
      { shipping_option_id: option.id }
    )
  },
  async (undo, { container }) => {
    if (!undo?.shipping_option_id) return
    await deleteShippingOptionsWorkflow(container)
      .run({ input: { ids: [undo.shipping_option_id] } })
      .catch(() => {})
  }
)

/**
 * Create the cart, bound to the quote's buyer.
 *
 * 🔴 `customer_id` is set HERE, at creation, and comes from the quote. The
 * minted price list is ruled on `customer.groups.id`; a cart without that
 * customer prices every line at base and the whole quote evaporates into an
 * ordinary retail basket. Setting it afterwards is not equivalent — the lines
 * are priced as they are added.
 */
const createQuoteCartStep = createStep(
  "create-quote-cart-step",
  async (
    input: {
      quote: any
      lines: any[]
      store: any
      shipping_address?: AcceptQuoteInput["shipping_address"]
    },
    { container }
  ) => {
    const { quote, lines, store } = input

    const address = {
      first_name: input.shipping_address?.first_name ?? quote.recipient_name ?? null,
      last_name: input.shipping_address?.last_name ?? null,
      company: input.shipping_address?.company ?? quote.recipient_company ?? null,
      address_1: input.shipping_address?.address_1 ?? null,
      address_2: input.shipping_address?.address_2 ?? null,
      // The destination the freight was rated against wins over anything the
      // caller sends for country: a buyer must not be able to move the shipment
      // to a lane this quote was never priced for.
      country_code: String(quote.destination_country_code).toLowerCase(),
      city: input.shipping_address?.city ?? quote.destination_city ?? null,
      postal_code: input.shipping_address?.postal_code ?? quote.destination_postal_code ?? null,
      province: input.shipping_address?.province ?? null,
      phone: input.shipping_address?.phone ?? null,
    }

    const { result: cart } = await createCartWorkflow(container).run({
      input: {
        region_id: quote.region_id ?? store?.default_region_id ?? undefined,
        currency_code: quote.currency_code,
        sales_channel_id: store.default_sales_channel_id,
        customer_id: quote.customer_id,
        email: quote.email_sent_to ?? undefined,
        shipping_address: address as any,
        items: (lines ?? []).map((l: any) => ({
          variant_id: l.variant_id,
          quantity: Number(l.quantity),
        })),
        metadata: {
          // Provenance for anything downstream reading a cart in isolation.
          // ⚠️ NOT the mechanism that scopes the freight option — the list
          // workflows do not fetch cart metadata at all. See the hook.
          quote_id: quote.id,
          partner_id: quote.partner_id,
        },
      } as any,
    })

    return new StepResponse({ cart_id: (cart as any).id }, { cart_id: (cart as any).id })
  },
  async (undo, { container }) => {
    if (!undo?.cart_id) return
    const cartService: any = container.resolve(Modules.CART)
    await cartService.deleteCarts([undo.cart_id]).catch(() => {})
  }
)

/** Put the frozen freight on the cart, via the option minted for it. */
const addQuoteFreightStep = createStep(
  "add-quote-freight-step",
  async (
    input: { cart_id: string; shipping_option_id: string },
    { container }
  ) => {
    await addShippingMethodToCartWorkflow(container).run({
      input: {
        cart_id: input.cart_id,
        options: [{ id: input.shipping_option_id }],
      },
    })
    return new StepResponse({ ok: true })
  }
)

/**
 * Assert the cart charges what the quote promised.
 *
 * 🔑 This step is the point of the slice. Everything before it can succeed and
 * still produce a cart that prices at base, ships free, or taxes an export at a
 * destination rate. A 200 proves a cart exists.
 *
 * Subtotal and freight are compared to the frozen numbers exactly (to the
 * hundredth). Tax is compared too, because a cart taxed by the buyer's region
 * is exactly how #1447 over-quoted an Indian export at German VAT — but it can
 * be waived deliberately, and the waiver is recorded.
 */
const assertCartMatchesQuoteStep = createStep(
  "assert-cart-matches-quote-step",
  async (
    input: {
      cart_id: string
      quote: any
      allow_tax_divergence: boolean
      /** The basket actually being bought — the dial applied, or the quoted one. */
      lines?: any[]
      store?: any
      /** True when the buyer moved quantities, so the frozen columns are stale. */
      dialled?: boolean
      /**
       * ⚠️ Typed loosely on purpose. Step input is SERIALIZED, so a `Date`
       * handed between steps arrives here as an ISO string — that exact
       * assumption threw on every acceptance in S11. It is re-wrapped in
       * `new Date(...)` at the point of use rather than trusted.
       */
      now?: Date | string
    },
    { container }
  ) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "currency_code",
        "item_total",
        "item_subtotal",
        "shipping_total",
        "shipping_subtotal",
        "tax_total",
        "total",
      ],
      filters: { id: input.cart_id },
    })
    const cart = (carts ?? [])[0] as any
    if (!cart) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "The accepted cart vanished")
    }

    const quote = input.quote
    const problems: string[] = []

    /**
     * 🔴 COMPARE LIKE WITH LIKE.
     *
     * `item_subtotal` is the cart's goods EX tax; `item_total` includes it.
     * When the catalogue's prices are tax-inclusive — which on prod they all
     * are — the quote's frozen `quoted_subtotal` is a tax-INCLUSIVE number, so
     * checking it against `item_subtotal` compares ₹90,000 with ₹76,271.19 and
     * refuses a cart that is in fact exactly right. That ratio is 1.18, the GST
     * rate, which is what gave the bug away.
     *
     * This made acceptance impossible on prod for BOTH lanes, and the message
     * it produced blamed the price list — the one thing that was working.
     */
    const quotedInclusive = Boolean(quote.quoted_tax_inclusive)

    /**
     * 🔴 What the buyer is owed a match against, once they have moved the dial.
     *
     * The frozen `quoted_*` columns describe the basket as MINTED. The moment a
     * buyer changes a quantity those numbers describe something nobody is
     * buying, and comparing against them would refuse every dialled
     * acceptance — the same class of error as comparing a tax-inclusive total
     * against an ex-tax one.
     *
     * So the expectation is rebuilt from `buildQuoteView` with the dialled
     * lines: the SAME builder, the same price list, the same customer group
     * that produced the number on the buyer's screen. The contract is unchanged
     * and still the one that matters — the cart must cost what the page said —
     * it is simply asked of the basket actually being bought.
     *
     * Freight is NOT rebuilt. The cart charges the flat option minted from the
     * frozen freight, so the frozen figure remains the right expectation even
     * when the weight moves; re-rating here would invent a second number and
     * then complain the cart disagreed with it.
     */
    let expectedSubtotal = Number(quote.quoted_subtotal ?? 0)
    /**
     * 🔴 The TAX expectation has to move with the basket too (#1439 S13).
     *
     * The subtotal was rebuilt for a dialled basket below and the tax was not,
     * so it kept comparing the cart against `quoted_tax_total` — the figure
     * frozen at mint, for the quantity the buyer just changed. On any taxed
     * lane that is a guaranteed mismatch: a quote minted at 2 units and dialled
     * to 7 offered `quoted 250.25, cart 875.25` and refused, which is the whole
     * S13 feature made unusable across all of India.
     *
     * 🔑 Invisible to the accept suite, which passes 7/7. Its fixture region
     * carries no tax, so quoted and cart tax are both 0 and agree by
     * coincidence — a constant that makes the assertion vacuous exactly where
     * it matters. Found by minting a real quote against a real region and
     * pressing accept.
     */
    let expectedTax =
      quote.quoted_tax_total === null || quote.quoted_tax_total === undefined
        ? null
        : Number(quote.quoted_tax_total)
    if (input.dialled) {
      const view = await buildQuoteView(container, {
        quote: null,
        lines: (input.lines ?? []).map((l: any) => ({
          variant_id: l.variant_id,
          quantity: Number(l.quantity),
        })),
        customer_group_id: quote.customer_group_id,
        destination_country_code: quote.destination_country_code,
        destination_postal_code: quote.destination_postal_code ?? null,
        currency_code: quote.currency_code,
        region_id: quote.region_id ?? null,
        store: {
          id: quote.store_id ?? undefined,
          default_location_id: input.store?.default_location_id ?? null,
        },
        partner_id: quote.partner_id ?? null,
        // The frozen freight stands in, so the view cannot re-rate the lane and
        // disagree with the option the cart is actually charged.
        freight_override_amount: Number(quote.quoted_freight ?? 0) || null,
        now: input.now ? new Date(input.now) : new Date(),
      })
      expectedSubtotal = Number(view?.live?.subtotal ?? view?.quoted?.subtotal ?? 0)
      // Same builder, same price list, same frozen freight — so the tax is the
      // one the buyer was shown for the basket they actually dialled. Left
      // alone when the view cannot resolve one, so an unknown tax still falls
      // back to the frozen figure rather than silently becoming "no tax".
      if (view?.tax?.total !== null && view?.tax?.total !== undefined) {
        expectedTax = Number(view.tax.total)
      }
    }

    const quotedSubtotal = expectedSubtotal
    const cartSubtotal = quotedInclusive
      ? Number(cart.item_total ?? cart.item_subtotal ?? 0)
      : Number(cart.item_subtotal ?? cart.item_total ?? 0)
    if (!near(quotedSubtotal, cartSubtotal)) {
      problems.push(
        `goods: quoted ${quotedSubtotal} ${quote.currency_code}, cart ${cartSubtotal} ` +
          `(compared ${quotedInclusive ? "tax-inclusive" : "ex-tax"}) — ` +
          `the price list did not price this cart (is the customer on the quote's group?)`
      )
    }

    const quotedFreight = Number(quote.quoted_freight ?? 0)
    const cartFreight = quotedInclusive
      ? Number(cart.shipping_total ?? cart.shipping_subtotal ?? 0)
      : Number(cart.shipping_subtotal ?? cart.shipping_total ?? 0)
    if (!near(quotedFreight, cartFreight)) {
      problems.push(
        `freight: quoted ${quotedFreight} ${quote.currency_code}, cart ${cartFreight}`
      )
    }

    let taxDivergence: number | null = null
    const quotedTax = expectedTax
    const cartTax = Number(cart.tax_total ?? 0)
    if (quotedTax !== null && !near(quotedTax, cartTax)) {
      taxDivergence = Number((cartTax - quotedTax).toFixed(2))
      if (!input.allow_tax_divergence) {
        problems.push(
          `tax: quoted ${quotedTax} ${quote.currency_code}, cart ${cartTax}. ` +
            `Quote tax follows the SELLER's jurisdiction (#1447); the cart is taxed by its own region. ` +
            `Pass allow_tax_divergence to accept knowingly.`
        )
      }
    }

    if (problems.length) {
      // Every failure at once, not the first — the same reason the mint's
      // readiness gate reports them all rather than making a partner play
      // whack-a-mole across five round trips.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The cart does not match the quote it came from:\n- ${problems.join("\n- ")}`
      )
    }

    return new StepResponse({
      total: Number(cart.total ?? 0),
      currency_code: cart.currency_code,
      tax_divergence: taxDivergence,
    })
  }
)

/** Open the deposit/balance ledger for this cart. */
const openPaymentScheduleStep = createStep(
  "open-quote-payment-schedule-step",
  async (
    input: {
      cart_id: string
      quote: any
      total: number
      currency_code: string
      tax_divergence: number | null
    },
    { container }
  ) => {
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

    const existing = await schedules.findByCartId(input.cart_id)
    if (existing) {
      return new StepResponse({ schedule_id: existing.id }, null)
    }

    const schedule = await schedules.openForCart({
      cart_id: input.cart_id,
      currency_code: input.currency_code,
      total_due: input.total,
      source_type: "quote",
      source_id: input.quote.id,
      // PayU is an INR rail and only an INR rail. Everything else goes to
      // Stripe, which is live (`STRIPE_CONNECT_ENABLED=true`) but whose adapter
      // lands in the following slice — until then a non-INR deal is `manual`
      // in all but name and an operator settles it against an invoice.
      rail: String(input.currency_code).toLowerCase() === "inr" ? "payu" : "stripe",
      quote_deposit_pct: input.quote.deposit_pct ?? null,
      metadata:
        input.tax_divergence !== null
          ? { tax_divergence: input.tax_divergence, tax_divergence_allowed: true }
          : null,
    })

    return new StepResponse({ schedule_id: schedule.id }, { schedule_id: schedule.id })
  },
  async (undo, { container }) => {
    if (!undo?.schedule_id) return
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    await schedules.deletePaymentSchedules([undo.schedule_id]).catch(() => {})
  }
)

/**
 * Stamp the acceptance on the quote.
 *
 * Last, deliberately: `accepted_cart_id` is the idempotency key, so it must not
 * exist until there is a cart that passed every assertion above. Written early,
 * a failed acceptance would leave a quote pointing at a cart that prices
 * nothing and can never be accepted again.
 */
/**
 * Point the quote at its cart, BEFORE the freight option has to be visible.
 *
 * ## 🔴 The contradiction this resolves
 *
 * The minted freight option carries a rule `quote_id eq <quote>`, and the hook
 * that puts `quote_id` into the matching context resolves it by looking the
 * quote up **by `accepted_cart_id`**. That column was written by
 * `markQuoteAcceptedStep`, which runs LAST — after `addQuoteFreightStep`. So at
 * the moment the option had to be visible it never was, the rule failed, and
 * core answered "Shipping Options are invalid for cart".
 *
 * Acceptance could therefore never complete. It was not a rare edge: every
 * single acceptance died there, and nothing caught it because the two halves
 * are correct in isolation — the hook's own docblock even predicts this exact
 * error message for a related mistake.
 *
 * ## Why this is not simply "move the mark earlier"
 *
 * `accepted_cart_id` is also the IDEMPOTENCY key: a set value makes the next
 * POST return the existing cart instead of minting a second one. Writing the
 * full acceptance early would mean a half-finished run whose compensation also
 * failed leaves a quote that reports itself accepted while pointing at a cart
 * with no freight and no payment schedule — permanently unacceptable, which is
 * exactly what the original ordering was protecting against.
 *
 * So the two facts are separated. This step writes only the POINTER, and
 * `accepted_at` remains the mark of a completed acceptance. The idempotency
 * check requires BOTH, so a partial run is retried rather than resurrected.
 */
const linkQuoteCartStep = createStep(
  "link-quote-cart-step",
  async (input: { quote_id: string; cart_id: string }, { container }) => {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    await service.updatePartnerQuotes({
      id: input.quote_id,
      accepted_cart_id: input.cart_id,
    })
    return new StepResponse({ ok: true }, { quote_id: input.quote_id })
  },
  async (undo, { container }) => {
    if (!undo?.quote_id) return
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    await service
      .updatePartnerQuotes({ id: undo.quote_id, accepted_cart_id: null })
      .catch(() => {})
  }
)

const markQuoteAcceptedStep = createStep(
  "mark-quote-accepted-step",
  async (
    input: { quote_id: string; cart_id: string; now: Date },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    await service.updatePartnerQuotes({
      id: input.quote_id,
      accepted_cart_id: input.cart_id,
      accepted_at: new Date(input.now),
    })
    return new StepResponse({ ok: true }, { quote_id: input.quote_id })
  },
  async (undo, { container }) => {
    if (!undo?.quote_id) return
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    await service
      .updatePartnerQuotes({
        id: undo.quote_id,
        accepted_cart_id: null,
        accepted_at: null,
      })
      .catch(() => {})
  }
)


/**
 * Resolve "now" inside a step.
 *
 * ⚠️ Never in the workflow body: `createWorkflow`'s function runs once to build
 * the graph, so a `new Date()` there would freeze one timestamp across every
 * future run — the same trap the mint's `prepareTimingStep` documents.
 */
const prepareAcceptTimingStep = createStep(
  "prepare-accept-timing-step",
  async (input: { now?: Date }) => {
    return new StepResponse({ now: input?.now ? new Date(input.now) : new Date() })
  }
)

/**
 * Read back an acceptance that already happened.
 *
 * The idempotent path does no writes at all: it returns the cart and schedule
 * the first acceptance produced. A second POST from a buyer who double-clicked
 * must not mint a second cart against the same price list, and must not look
 * like a failure either.
 */
const loadExistingAcceptanceStep = createStep(
  "load-existing-acceptance-step",
  async (input: { cart_id: string }, { container }) => {
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByCartId(input.cart_id)
    return new StepResponse({
      cart_id: input.cart_id,
      schedule_id: schedule?.id ?? null,
    })
  }
)

export const acceptQuoteWorkflow = createWorkflow(
  "accept-quote",
  (input: AcceptQuoteInput) => {
    const timing = prepareAcceptTimingStep({ now: input.now })

    const loaded = loadQuoteForAcceptStep({
      quote_id: input.quote_id,
      now: timing.now,
      dialled_lines: input.dialled_lines ?? null,
    })

    // Already accepted → read it back, write nothing.
    const existing = when(
      "already-accepted",
      { loaded },
      ({ loaded }) => !!loaded.existing_cart_id
    ).then(() => {
      return loadExistingAcceptanceStep({
        cart_id: loaded.existing_cart_id as unknown as string,
      })
    })

    const fresh = when(
      "not-yet-accepted",
      { loaded },
      ({ loaded }) => !loaded.existing_cart_id
    ).then(() => {
      const option = createQuoteFreightOptionStep({ quote: loaded.quote })

      const cart = createQuoteCartStep({
        quote: loaded.quote,
        lines: loaded.lines,
        store: loaded.store,
        shipping_address: input.shipping_address,
      })

      // BEFORE the freight. The option is ruled to this quote and the context
      // hook resolves that rule by `accepted_cart_id`, so the pointer has to
      // exist by the time core validates the option against the cart.
      linkQuoteCartStep({
        quote_id: input.quote_id,
        cart_id: cart.cart_id,
      })

      addQuoteFreightStep({
        cart_id: cart.cart_id,
        shipping_option_id: option.shipping_option_id,
      })

      const totals = assertCartMatchesQuoteStep({
        cart_id: cart.cart_id,
        quote: loaded.quote,
        allow_tax_divergence: input.allow_tax_divergence as unknown as boolean,
        lines: loaded.lines,
        store: loaded.store,
        dialled: loaded.dialled,
        now: timing.now,
      })

      const schedule = openPaymentScheduleStep({
        cart_id: cart.cart_id,
        quote: loaded.quote,
        total: totals.total,
        currency_code: totals.currency_code,
        tax_divergence: totals.tax_divergence,
      })

      // LAST. `accepted_cart_id` is the idempotency key, so it must not exist
      // until there is a cart that passed every assertion above; written early,
      // a failed acceptance would leave the quote pointing at a cart that
      // prices nothing and can never be accepted again.
      markQuoteAcceptedStep({
        quote_id: input.quote_id,
        cart_id: cart.cart_id,
        now: timing.now,
      })

      /**
       * Announce it, so a visual flow can act on a buyer saying yes — chase the
       * deposit, tell the partner, start production paperwork.
       *
       * Inside the `when` on purpose: this is the FRESH acceptance branch, so a
       * second click lands on `already_accepted` and emits nothing. An event
       * that fired on every re-POST would have a flow mailing the partner once
       * per page refresh.
       */
      emitEventStep({
        eventName: PARTNER_QUOTE_EVENTS.ACCEPTED,
        data: {
          id: input.quote_id,
          quote_id: input.quote_id,
          cart_id: cart.cart_id,
          schedule_id: schedule.schedule_id,
        },
      })

      return transform({ cart, schedule }, ({ cart, schedule }) => ({
        cart_id: cart.cart_id,
        schedule_id: schedule.schedule_id,
      }))
    })

    return new WorkflowResponse(
      transform({ existing, fresh }, ({ existing, fresh }) => ({
        cart_id: (existing?.cart_id ?? fresh?.cart_id) as string,
        schedule_id: (existing?.schedule_id ?? fresh?.schedule_id) ?? null,
        already_accepted: !!existing?.cart_id,
      }))
    )
  }
)
