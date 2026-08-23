import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createPriceListsWorkflow,
  deletePriceListsWorkflow,
  updatePriceListsWorkflow,
} from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import {
  buildQuoteView,
  resolveStoreOriginCountry,
} from "../../modules/partner-quote/lib/build-quote-view"
import { normaliseTaxId } from "../../modules/partner-quote/lib/quote-parties"
import { assessQuoteReadiness } from "../../modules/partner-quote/lib/quote-readiness"
import {
  generateQuoteToken,
  quoteExpiryFrom,
  DEFAULT_QUOTE_TTL_DAYS,
} from "../../modules/partner-quote/lib/token"
import { composeQuoteMoney } from "../../modules/partner-quote/lib/build-quote-view"
import {
  classifyQuoteJurisdiction,
  resolveQuoteTax,
} from "../../modules/partner-quote/lib/quote-tax"
import { fetchExchangeRate } from "../../lib/fx/exchange-rate"
import { pickDefaultCurrency } from "../../lib/resolve-store-currency"
import { needsExchangeRate, resolveLineOverride } from "./lib/line-override"
import {
  planQuotePrices,
  priceListScopedToGroup,
  QUOTE_GROUP_RULE_ATTRIBUTE,
} from "./lib/plan-quote-prices"

export type MintQuoteInput = {
  partner_id: string
  store: { id: string; default_location_id?: string | null }
  buyer_email: string
  recipient_name?: string | null
  recipient_company?: string | null
  /** The buyer's own registration, as stated. Recorded, never verified. */
  buyer_tax_id?: string | null
  buyer_tax_id_type?: string | null
  partner_note?: string | null
  lines: Array<{
    variant_id: string
    /**
     * The design this line was picked as (#1486). Already resolved to
     * `variant_id` by the route — carried here only so the frozen line can
     * record which design the partner chose. It prices nothing.
     */
    design_id?: string | null
    quantity: number
    position?: number
    note?: string | null
    /** 0-100, off the live catalog price at this line's quantity (#1439 S7). */
    discount_percent?: number | null
    /** A flat unit price, in the PARTNER STORE's default currency. */
    override_unit_amount?: number | null
  }>
  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null
  currency_code: string
  region_id?: string | null
  carrier?: string
  /** Quote as DDP — we pay the destination duty and import tax (#1447). */
  duties_prepaid?: boolean
  /**
   * The duty amount we are undertaking to pay, in the QUOTE currency, and the
   * note saying how it was arrived at (#1447).
   *
   * Entered by hand because nothing can derive it yet: HS codes are incomplete
   * and Shiprocket's tariff endpoint is gated on CSB-5 KYC. The validator
   * refuses `duties_prepaid` without an amount, so no quote can promise duty
   * cover and add nothing to the price.
   */
  duty_total?: number | null
  duty_basis?: string | null
  /**
   * The rate form, and the normal one. The amounts are computed by
   * `buildQuoteView` against the basket it actually priced — duty on
   * goods + freight, import tax on goods + freight + duty.
   */
  duty_rate_percent?: number | null
  import_tax_rate_percent?: number | null
  import_tax_total?: number | null
  /** The carrier's fee for advancing duty and tax. Always an amount. */
  ddp_fee_total?: number | null
  /**
   * Freight named by hand, in the QUOTE currency (#1439 S12).
   *
   * Replaces whatever the picker found, and satisfies the "no freight option"
   * refusal — which is what makes a cross-border lane quotable at all today,
   * since the carrier answers "no serviceable couriers available for given
   * weight" and the stored option is flat at any weight.
   */
  freight_override_amount?: number | null
  /** Who quoted it and on what basis. Evidence, like `duty_basis`. */
  freight_basis?: string | null
  ttl_days?: number
  /**
   * The deposit share of this deal, 0-100 (#1439 S11). Omit — or pass null —
   * to fall through to the partner's house terms and then the platform's 30%.
   * `0` is a real answer and is NOT treated as absent.
   */
  deposit_pct?: number | null
  created_by?: string | null
  /** Injected so the whole mint is deterministic under test. */
  now?: Date
}

/**
 * Resolve mint time and expiry INSIDE a step.
 *
 * ⚠️ Not in the workflow body: `createWorkflow`'s function runs once to build
 * the graph, and `input` there is a proxy — `input.ttl_days ?? DEFAULT` would
 * be evaluated against the proxy at definition time, not against the caller's
 * value at run time. `new Date()` in the body has the same problem, and would
 * additionally freeze one timestamp across every future run.
 */
const prepareTimingStep = createStep(
  "prepare-quote-timing-step",
  async (input: { ttl_days?: number; now?: Date }) => {
    const now = input?.now ? new Date(input.now) : new Date()
    return new StepResponse({
      now,
      expires_at: quoteExpiryFrom(now, input?.ttl_days ?? DEFAULT_QUOTE_TTL_DAYS),
    })
  }
)

/**
 * Find-or-create the buyer as a customer AND their own customer group, both
 * linked to the partner's store.
 *
 * One group PER BUYER, not per quote: a repeat buyer keeps one identity, so
 * their second quote replaces their prices rather than stacking a second list
 * that core would tie-break against the first on `amount ASC`.
 *
 * Compensation deletes only what THIS run created — never the customer, who
 * may have orders, and never a group that already existed.
 */
const resolveQuoteBuyerStep = createStep(
  "resolve-quote-buyer-step",
  async (input: MintQuoteInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const customerService: any = container.resolve(Modules.CUSTOMER)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const email = input.buyer_email.trim().toLowerCase()

    // Scoped to the store: another partner's customer with the same email is
    // not this partner's buyer, and reusing them would leak a customer across
    // tenants and hand them someone else's price list.
    const { data: storeRows } = await query.graph({
      entity: "stores",
      fields: ["customers.id", "customers.email", "customer_groups.id", "customer_groups.name"],
      filters: { id: input.store.id },
    })
    const storeRow = (storeRows ?? [])[0] as any

    let customer = ((storeRow?.customers ?? []) as any[]).find(
      (c) => String(c?.email ?? "").toLowerCase() === email
    )
    let createdCustomerId: string | null = null
    if (!customer) {
      customer = await customerService.createCustomers({
        email,
        company_name: input.recipient_company ?? undefined,
      })
      createdCustomerId = customer.id
      await link.create({
        [Modules.STORE]: { store_id: input.store.id },
        [Modules.CUSTOMER]: { customer_id: customer.id },
      })
    }

    const groupName = `Quote buyer — ${email}`
    let group = ((storeRow?.customer_groups ?? []) as any[]).find(
      (g) => g?.name === groupName
    )
    let createdGroupId: string | null = null
    if (!group) {
      group = await customerService.createCustomerGroups({ name: groupName })
      createdGroupId = group.id
      await link.create({
        [Modules.STORE]: { store_id: input.store.id },
        [Modules.CUSTOMER]: { customer_group_id: group.id },
      })
    }

    // Idempotent by construction: adding a customer already in the group is a
    // no-op, and a repeat quote for the same buyer takes this path every time.
    await customerService.addCustomerToGroup({
      customer_id: customer.id,
      customer_group_id: group.id,
    })

    return new StepResponse(
      { customer_id: customer.id, customer_group_id: group.id },
      { createdCustomerId, createdGroupId, storeId: input.store.id }
    )
  },
  async (undo, { container }) => {
    if (!undo) return
    const customerService: any = container.resolve(Modules.CUSTOMER)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    if (undo.createdGroupId) {
      await link
        .dismiss({
          [Modules.STORE]: { store_id: undo.storeId },
          [Modules.CUSTOMER]: { customer_group_id: undo.createdGroupId },
        })
        .catch(() => {})
      await customerService
        .deleteCustomerGroups([undo.createdGroupId])
        .catch(() => {})
    }
    if (undo.createdCustomerId) {
      await link
        .dismiss({
          [Modules.STORE]: { store_id: undo.storeId },
          [Modules.CUSTOMER]: { customer_id: undo.createdCustomerId },
        })
        .catch(() => {})
      await customerService
        .deleteCustomers([undo.createdCustomerId])
        .catch(() => {})
    }
  }
)

/**
 * Refuse to quote what cannot be shipped or priced (#1445).
 *
 * Every wrong number this feature produced was minted SUCCESSFULLY — a
 * zone-blind freight pick, a rupee rate in a euro total, a rule-bound zero
 * that shipped bulk free. In each case the mint returned 201 and nobody knew.
 * This is the gate that turns those into a refusal.
 *
 * 🔑 It reports EVERY blocking failure at once, not the first. A partner
 * fixing a quote one error at a time plays whack-a-mole across five round
 * trips; the wizards call the same assessor up front so the mint button is
 * only live when it would produce a number worth acting on.
 *
 * ⚠️ `check_catalogue` is false here. The workflow's `store` input carries the
 * location but not the sales channel, and the admin route already runs
 * `assertVariantsInStore` with the channel it fetched. Checking with a missing
 * channel would either refuse every quote or — worse — silently pass. The
 * readiness ENDPOINTS do the catalogue half, where the channel is in hand.
 */
const validateQuoteReadinessStep = createStep(
  "validate-quote-readiness-step",
  async (input: MintQuoteInput, { container }) => {
    const readiness = await assessQuoteReadiness(container, {
      lines: input.lines,
      store: input.store,
      destination_country_code: input.destination_country_code,
      destination_postal_code: input.destination_postal_code,
      currency_code: input.currency_code,
      region_id: input.region_id,
      carrier: input.carrier,
      check_catalogue: false,
    })

    if (!readiness.ready) {
      const blocking = readiness.issues.filter((i) => i.severity === "blocking")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `This quote cannot be minted:\n${blocking.map((i) => `• ${i.message}`).join("\n")}`
      )
    }

    return new StepResponse(readiness)
  }
)

/**
 * Build the view ONCE and freeze it. Everything downstream — the price list,
 * the row, the email — is written from this single output, which is what stops
 * a second pricing path from existing.
 */
const buildAndFreezeStep = createStep(
  "build-and-freeze-quote-step",
  async (
    payload: { mint: MintQuoteInput; now: Date },
    { container }
  ) => {
    const input = payload.mint
    const view = await buildQuoteView(container, {
      quote: null,
      lines: input.lines,
      destination_country_code: input.destination_country_code,
      destination_postal_code: input.destination_postal_code ?? null,
      currency_code: input.currency_code,
      region_id: input.region_id ?? null,
      store: input.store,
      carrier: input.carrier,
      // The row does not exist yet, so the undertaking is supplied directly —
      // it changes the disclosure the buyer is shown, which then gets frozen.
      duties_prepaid: input.duties_prepaid ?? false,
      duty_total: input.duty_total ?? null,
      duty_basis: input.duty_basis ?? null,
      duty_rate_percent: input.duty_rate_percent ?? null,
      import_tax_rate_percent: input.import_tax_rate_percent ?? null,
      import_tax_total: input.import_tax_total ?? null,
      ddp_fee_total: input.ddp_fee_total ?? null,
      // #1439 S12 — freight the partner named. Passed like the DDP figures and
      // for the same reason: the row does not exist yet, so what the buyer is
      // shown has to be supplied here before it is frozen.
      freight_override_amount: input.freight_override_amount ?? null,
      freight_basis: input.freight_basis ?? null,
      now: payload.now,
    })

    /**
     * 🔴 DDP is meaningless on a domestic lane, and not harmlessly so.
     *
     * There is no border, so no duty and no import tax arise — but the charges
     * are ADDED to the buyer's total, so a mistakenly-ticked flag bills them for
     * a customs event that will never happen. The wizards hide the section on a
     * domestic destination; this refuses it, because a hidden field is a UI
     * convention and the API is reachable without one.
     *
     * `unknown_origin` is deliberately allowed through: the tax block already
     * says the treatment could not be determined, and refusing a promise the
     * partner may have good reason to make — on evidence we do not have — is
     * the wrong side to fail on.
     */
    if (input.duties_prepaid) {
      const jurisdiction = classifyQuoteJurisdiction(
        view.origin_country_code,
        input.destination_country_code
      )
      if (jurisdiction === "domestic") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `This quote ships within ${String(
            input.destination_country_code || ""
          ).toUpperCase()}, so no import duty or tax arises and there is nothing to prepay. ` +
            "Nothing was written — a DDP charge on a domestic lane bills the buyer for a border they never cross."
        )
      }
    }

    if (!view.live) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The quote could not be priced${
          view.live_error ? `: ${view.live_error}` : ""
        }. Nothing was written — a quote whose numbers we cannot stand behind must not be sent.`
      )
    }

    return new StepResponse(view)
  }
)

/**
 * Apply the partner's trade prices, and rewrite the view around them (#1439 S7).
 *
 * ## Why this replaces the numbers IN THE VIEW rather than beside them
 *
 * The whole point of `build-quote-view.ts` is that ONE builder feeds the page,
 * the email and the freeze, so no second pricing path can disagree with what
 * the buyer sees. An override carried alongside the view would create exactly
 * that second path: the price list would hold the trade price while the frozen
 * `quoted_subtotal` and the buyer's page still showed retail.
 *
 * So the override is folded back in — per line, and then the basket totals are
 * recomposed from the overridden subtotals with the same `composeQuoteMoney`
 * the builder used. Downstream, nothing knows an override happened; there is
 * still exactly one number per line.
 *
 * Freight is untouched. A trade price is a discount on goods, not on shipping,
 * and the consignment costs what it costs.
 *
 * ## FX is fetched at most once, and only when it is actually needed
 *
 * A same-currency mint — the overwhelming majority — never touches the
 * network, so an FX outage cannot block one. When a rate IS needed and cannot
 * be had, the mint FAILS: `fetchExchangeRate` throws and nothing here catches
 * it. A conversion that silently falls back to 1 does not fail, it quotes
 * 60,000 INR as 60,000 USD.
 */
const applyLineOverridesStep = createStep(
  "apply-quote-line-overrides-step",
  async (
    payload: { mint: MintQuoteInput; view: any },
    { container }
  ) => {
    const input = payload.mint
    const view = payload.view
    const overrideByVariant = new Map(
      (input.lines ?? []).map((l) => [l.variant_id, l])
    )

    const anyOverride = (input.lines ?? []).some(
      (l) =>
        (l.discount_percent !== null && l.discount_percent !== undefined) ||
        (l.override_unit_amount !== null && l.override_unit_amount !== undefined)
    )
    if (!anyOverride) {
      // Nothing to do, and — importantly — no store read and no FX call on the
      // path every ordinary quote takes.
      return new StepResponse(view)
    }

    // ---- The currency the partner typed in ------------------------------
    // Shaped by the same helper every other currency decision uses (#485), but
    // with an EMPTY fallback rather than its default "inr": `resolveStoreCurrency`
    // never throws and always returns a usable code, which is right for
    // stamping a work order and wrong here. Guessing a currency for a number
    // someone typed is how a rupee price gets quoted as dollars.
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    let storeCurrency = ""
    try {
      const { data: stores } = await query.graph({
        entity: "store",
        // `supported_currencies.*` MUST be expanded or the default flag is
        // absent and every currency reads as "not default".
        fields: ["id", "supported_currencies.*"],
        filters: { id: input.store.id },
      })
      storeCurrency = pickDefaultCurrency((stores ?? [])[0], "")
    } catch {
      storeCurrency = ""
    }

    if (!storeCurrency) {
      // 🔴 Never fall back to the quote currency. The override is a number in
      // the partner's own currency; assuming it is already in the buyer's is
      // how a rupee price gets quoted as dollars.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "This store has no default currency, so a per-line override has no currency to be read in. " +
          "Nothing was written."
      )
    }

    const rate = needsExchangeRate(
      input.lines ?? [],
      storeCurrency,
      input.currency_code
    )
      ? await fetchExchangeRate(storeCurrency, input.currency_code)
      : 1

    const lines = (view?.lines ?? []).map((l: any) => {
      const requested = overrideByVariant.get(l.variant_id)
      const resolved = resolveLineOverride({
        live_unit_amount: l.live_unit_amount ?? null,
        discount_percent: requested?.discount_percent ?? null,
        override_unit_amount: requested?.override_unit_amount ?? null,
        fx_rate: rate,
        store_currency_code: storeCurrency,
        quote_currency_code: input.currency_code,
      })

      return {
        ...l,
        live_unit_amount: resolved.unit_amount,
        live_subtotal:
          resolved.unit_amount === null
            ? null
            : resolved.unit_amount * Number(l.quantity),
        override: resolved.override,
      }
    })

    const priced = lines.filter((l: any) => l.live_subtotal !== null)

    /**
     * 🔴 Tax is RE-ASKED against the overridden prices, not carried over.
     *
     * `buildQuoteView` computed it from the catalogue prices, before this step
     * existed to discount them. A 20% trade price on a domestic quote therefore
     * froze 18% GST on the RETAIL subtotal — tax on money the buyer was never
     * asked for, in the confident direction, on exactly the quotes a partner
     * had negotiated. The number that gets frozen is `view.tax`, so this was
     * wrong in the row as well as on the page.
     *
     * Same module, same inputs, one different set of line amounts — so the
     * quote and the cart that later prices itself still cannot disagree.
     * `resolveQuoteTax` never throws: an unresolvable rate lands on `unknown`
     * WITH a reason, which is what the page renders.
     */
    const originCountry = await resolveStoreOriginCountry(
      container,
      input.store?.default_location_id
    )
    const chosenFreight = view?.freight?.chosen ?? null
    const tax =
      view?.live && chosenFreight
        ? await resolveQuoteTax(container, {
            region_id: input.region_id ?? null,
            origin_country_code: originCountry,
            duties_prepaid: Boolean(input.duties_prepaid),
            destination_country_code: input.destination_country_code,
            destination_postal_code: input.destination_postal_code ?? null,
            lines: priced.map((l: any) => ({
              variant_id: l.variant_id,
              product_id: l.product_id ?? null,
              // The OVERRIDDEN unit price. Passing the catalogue one here is
              // the whole defect this re-ask exists to remove.
              unit_amount: Number(l.live_unit_amount ?? 0),
              quantity: Number(l.quantity ?? 0),
            })),
            freight: {
              amount: Number(chosenFreight.amount ?? 0),
              option_id: chosenFreight.shipping_option_id ?? null,
            },
          })
        : view?.tax

    /**
     * 🔴 Tax and duty are carried across the recompose, not dropped.
     *
     * This call used to pass subtotals and freight only, so `tax_total`,
     * `duty_total` and `gross_total` all came back null on any quote with a
     * trade price — the buyer page showed no total at all, on precisely the
     * quotes a partner had priced by hand. The freeze reads `view.tax`
     * separately, so the row was right and only the page was wrong, which is
     * why it survived.
     */
    const live = view?.live
      ? composeQuoteMoney(
          priced.map((l: any) => Number(l.live_subtotal)),
          priced.reduce((sum: number, l: any) => sum + Number(l.quantity), 0),
          Number(view.live.freight ?? 0),
          tax
            ? { total: tax.total ?? null, inclusive: Boolean(tax.inclusive) }
            : null,
          view.live.duty_total ?? null
        )
      : view?.live ?? null

    return new StepResponse({ ...view, lines, live, tax })
  }
)

/**
 * Write the buyer's prices for real, scoped to their group and dated to the
 * quote — so `ends_at` IS the expiry and `status: draft` IS the revoke.
 */
const mintPriceListStep = createStep(
  "mint-quote-price-list-step",
  async (
    input: {
      partner_id: string
      customer_group_id: string
      currency_code: string
      expires_at: Date
      now: Date
      lines: Array<{ variant_id: string; quantity: number; quoted_unit_amount: number | null }>
    },
    { container }
  ) => {
    const prices = planQuotePrices(input.lines, input.currency_code)
    if (!prices.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No quoted line carried a price, so there is nothing to mint."
      )
    }

    /**
     * ⚠️ A step's input is SERIALIZED on the way in, so a `Date` handed over by
     * an earlier step arrives here as an ISO **string** — the declared
     * `now: Date` type describes the graph, not the runtime value, and tsc
     * cannot see the difference. Calling `.toISOString()` on it threw
     * `input.now.toISOString is not a function` and 500'd the mint.
     *
     * Re-hydrate rather than re-deriving: `prepareTimingStep` owns mint time
     * precisely so every downstream step shares ONE timestamp. Calling
     * `new Date()` here would silently reintroduce the drift that step exists
     * to prevent.
     */
    const now = new Date(input.now)
    const expiresAt = new Date(input.expires_at)

    const { result } = await createPriceListsWorkflow(container).run({
      input: {
        price_lists_data: [
          {
            title: `Quote — ${input.customer_group_id}`,
            description: `Quoted prices for customer group ${input.customer_group_id}, minted ${now.toISOString()}.`,
            status: "active",
            type: "override",
            starts_at: now.toISOString(),
            ends_at: expiresAt.toISOString(),
            // See QUOTE_GROUP_RULE_ATTRIBUTE — `customer_group_id` here
            // creates a price list that no cart can ever match.
            rules: { [QUOTE_GROUP_RULE_ATTRIBUTE]: [input.customer_group_id] },
            prices,
          } as any,
        ],
      },
    })

    const priceList = (result as any[])?.[0]
    if (!priceList?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The price list was not created."
      )
    }

    // 🔴 Assert the rule from a RE-READ, never from the payload we sent. A list
    // with rules_count = 0 applies to EVERY customer on the platform, and core
    // treats that as universal rather than as an error — so an unruled list is
    // a silent platform-wide price cut. If the scope did not attach, delete it
    // and fail loudly.
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: verify } = await query.graph({
      entity: "price_list",
      fields: ["id", "rules_count", "price_list_rules.*"],
      filters: { id: priceList.id },
    })

    if (!priceListScopedToGroup((verify ?? [])[0], input.customer_group_id)) {
      await deletePriceListsWorkflow(container)
        .run({ input: { ids: [priceList.id] } })
        .catch(() => {})
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Price list ${priceList.id} was created without its customer-group rule, so it would have priced for everyone. It has been deleted.`
      )
    }

    return new StepResponse(
      { price_list_id: priceList.id, price_count: prices.length },
      priceList.id
    )
  },
  async (priceListId, { container }) => {
    if (!priceListId) return
    await deletePriceListsWorkflow(container)
      .run({ input: { ids: [priceListId] } })
      .catch(() => {})
  }
)

/**
 * Retire every EARLIER active quote for this buyer (#1435).
 *
 * ## The bug this exists to fix
 *
 * `resolveQuoteBuyerStep`'s docblock has claimed since the module was written
 * that a repeat buyer's second quote "replaces their prices rather than
 * stacking a second list that core would tie-break against the first on
 * `amount ASC`". **Nothing implemented that.** Two active price lists sat on
 * one customer group, both with `rules_count: 1`, and core's tie-break picked
 * the CHEAPEST — so a partner re-quoting the same buyer at a HIGHER price (
 * materials moved, quantity dropped a tier) handed them the old, cheaper
 * prices at checkout. The page showed the new number; the cart charged the old
 * one. Expiry did not rescue it either: each list carries its own TTL from its
 * own mint.
 *
 * A confident comment is not an implementation.
 *
 * ## Why `ends_at`, not delete
 *
 * Expiring the prior list is REVERSIBLE, and this step has to be: it runs
 * before `persistQuoteStep`, so a later failure must put the buyer's previous
 * quote back exactly as it was. A deleted price list cannot be restored, and
 * compensating a destructive act with a re-create would mint a NEW list id
 * that the old quote row does not point at. Setting `ends_at` to now stops the
 * list pricing any cart immediately — expiry is native, there is no sweeper —
 * and the compensation writes the original timestamp back.
 *
 * ## Ordering
 *
 * Runs AFTER the new price list is minted and verified, so a mint that fails
 * its own rule check never touches the buyer's existing quote. At this point
 * the new quote row does not exist yet, so every active quote found here is by
 * definition a prior one — no need to exclude self.
 */
const supersedePriorQuotesStep = createStep(
  "supersede-prior-quotes-step",
  async (
    input: { customer_group_id: string; now: Date },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    // See the note in `mintPriceListStep`: a Date crossing a step boundary
    // arrives as an ISO string, and tsc cannot see it.
    const now = new Date(input.now)

    const priors = await service.listPartnerQuotes({
      customer_group_id: input.customer_group_id,
      status: "active",
    })

    if (!priors?.length) {
      return new StepResponse({ superseded: [] as string[] }, null)
    }

    const undo: Array<{
      quote_id: string
      price_list_id: string | null
      previous_ends_at: string | null
    }> = []

    for (const prior of priors) {
      let previousEndsAt: string | null = null

      if (prior.price_list_id) {
        // Read the CURRENT ends_at before overwriting it, so the compensation
        // restores the real value rather than a guess.
        const { data: lists } = await query.graph({
          entity: "price_list",
          fields: ["id", "ends_at"],
          filters: { id: prior.price_list_id },
        })
        const existing = (lists ?? [])[0] as any
        previousEndsAt = existing?.ends_at
          ? new Date(existing.ends_at).toISOString()
          : null

        if (existing) {
          await updatePriceListsWorkflow(container).run({
            input: {
              price_lists_data: [
                { id: prior.price_list_id, ends_at: now.toISOString() } as any,
              ],
            },
          })
        } else {
          // The list is already gone (revoked by hand, or cleaned up). Mark the
          // quote anyway — but say so, rather than reporting a clean supersede.
          logger.warn(
            `[quote] supersede ${prior.id}: price list ${prior.price_list_id} no longer exists`
          )
        }
      } else {
        logger.warn(
          `[quote] supersede ${prior.id}: no price_list_id recorded, nothing to expire`
        )
      }

      await service.updatePartnerQuotes({
        id: prior.id,
        status: "superseded",
      })

      await service
        .recordEvent({
          quote_id: prior.id,
          type: "superseded",
          actor_type: "system",
          message:
            "A newer quote was minted for this buyer, so this quote's prices were expired.",
          data: { price_list_id: prior.price_list_id ?? null },
        })
        .catch(() => {})

      undo.push({
        quote_id: prior.id,
        price_list_id: prior.price_list_id ?? null,
        previous_ends_at: previousEndsAt,
      })
    }

    logger.info(
      `[quote] superseded ${undo.length} prior quote(s) for group ${input.customer_group_id}`
    )

    return new StepResponse(
      { superseded: undo.map((u) => u.quote_id) },
      undo
    )
  },
  async (undo, { container }) => {
    if (!undo?.length) return
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)

    for (const row of undo) {
      if (row.price_list_id && row.previous_ends_at) {
        await updatePriceListsWorkflow(container)
          .run({
            input: {
              price_lists_data: [
                { id: row.price_list_id, ends_at: row.previous_ends_at } as any,
              ],
            },
          })
          .catch(() => {})
      }
      await service
        .updatePartnerQuotes({ id: row.quote_id, status: "active" })
        .catch(() => {})
    }
  }
)

/** Persist the quote and its lines, and mint the token. */
const persistQuoteStep = createStep(
  "persist-quote-step",
  async (
    input: {
      mint: MintQuoteInput
      view: any
      buyer: { customer_id: string; customer_group_id: string }
      price_list_id: string
      expires_at: Date
      now: Date
    },
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    const { raw, hash } = generateQuoteToken()

    const quote = await service.createPartnerQuotes({
      partner_id: input.mint.partner_id,
      store_id: input.mint.store.id,
      destination_country_code: input.mint.destination_country_code,
      destination_postal_code: input.mint.destination_postal_code ?? null,
      destination_city: input.mint.destination_city ?? null,
      currency_code: input.mint.currency_code,
      region_id: input.mint.region_id ?? null,
      recipient_name: input.mint.recipient_name ?? null,
      recipient_company: input.mint.recipient_company ?? null,
      // Normalised on write so two spellings of one registration compare equal.
      // `?? null` and never `?? ""` — a blank string on a tax document reads as
      // "registered, number withheld" rather than "none given".
      buyer_tax_id: normaliseTaxId(input.mint.buyer_tax_id ?? null),
      buyer_tax_id_type: input.mint.buyer_tax_id_type ?? null,
      email_sent_to: input.mint.buyer_email,
      partner_note: input.mint.partner_note ?? null,
      quoted_subtotal: input.view.live?.subtotal ?? null,
      quoted_freight: input.view.live?.freight ?? null,
      quoted_landed_total: input.view.live?.landed_total ?? null,
      quoted_weight_grams: input.view.total_weight_grams ?? null,
      // Tax frozen alongside the rest (#1439 S8). Read off `view.tax` rather
      // than `view.live.tax_total`: the money object carries the NUMBER, and a
      // number alone cannot distinguish "zero-rated export" from "we could not
      // work it out" — both are a 0 and only one of them is a fact.
      //
      // `?? null` throughout, never `?? 0`. A quote whose tax could not be
      // resolved must freeze as unknown; writing 0 would turn a gap into a
      // confident claim of no tax due, which is the failure this whole slice is
      // built around.
      quoted_tax_total: input.view.tax?.total ?? null,
      quoted_tax_inclusive: input.view.tax?.inclusive ?? null,
      quoted_tax_status: input.view.tax?.status ?? null,
      quoted_tax_reason: input.view.tax?.reason ?? null,
      // Frozen with the rest: it is part of what the buyer was promised, and a
      // later page read must show the same undertaking, not re-derive it.
      duties_prepaid: input.mint.duties_prepaid ?? false,
      // The duty figure freezes with the promise it backs. Read off the VIEW,
      // which has already refused to carry an amount on a non-DDP quote, so a
      // stray number in the body cannot be stored against a quote whose buyer
      // was told duty is theirs to pay.
      quoted_duty_total: input.view.duty?.total ?? null,
      // The other two thirds. Duty alone funds ~a quarter of a real EU
      // undertaking — the import tax is the big one and the carrier charges a
      // fee for advancing both.
      quoted_import_tax_total: input.view.duty?.import_tax ?? null,
      quoted_ddp_fee_total: input.view.duty?.carrier_fee ?? null,
      // Frozen so the amounts can be re-derived against a carrier invoice
      // months later rather than merely believed.
      quoted_duty_rate: input.view.duty?.duty_rate_percent ?? null,
      quoted_import_tax_rate: input.view.duty?.import_tax_rate_percent ?? null,
      quoted_duty_basis: input.view.duty?.basis ?? null,
      quoted_at: new Date(input.now),
      // #1439 S11 — which option the frozen freight was rated against. The
      // accepted cart's freight option is built in this option's service zone
      // and shipping profile, so the number the buyer pays and the number they
      // were quoted come from the same lane rather than from two lookups that
      // can disagree.
      quoted_shipping_option_id: input.view.freight?.chosen?.shipping_option_id ?? null,
      // #1439 S12 — where the frozen freight came from, read off the VIEW's
      // own decision rather than off the request, so this cannot claim "manual"
      // on a quote that was actually rated, or the reverse.
      //
      // 🔴 NOT `chosen.source`. That field already answers a different
      // question — stored option vs live carrier rate — and one of its answers
      // is also the word "manual". Reading it stamped every quote priced off a
      // stored tier as a human's figure.
      quoted_freight_source: input.view.freight?.overridden ? "manual" : "estimated",
      quoted_freight_basis: input.mint.freight_basis ?? null,
      // The agreed deposit share. Null when the partner did not name one, which
      // is not the same as 0 — see `resolveDepositPct`.
      deposit_pct:
        input.mint.deposit_pct === null || input.mint.deposit_pct === undefined
          ? null
          : Number(input.mint.deposit_pct),
      token_hash: hash,
      status: "active",
      expires_at: new Date(input.expires_at),
      created_by: input.mint.created_by ?? null,
      // #1440: columns, not metadata. `customer_group_id` is the key the
      // supersede step queries on, and a json key cannot be filtered.
      customer_id: input.buyer.customer_id,
      customer_group_id: input.buyer.customer_group_id,
      price_list_id: input.price_list_id,
    })

    await service.createPartnerQuoteLines(
      (input.view.lines ?? []).map((l: any, i: number) => ({
        quote_id: quote.id,
        variant_id: l.variant_id,
        product_id: l.product_id ?? null,
        // #1486 — which design this was picked as, or null for a product line.
        design_id: l.design_id ?? null,
        quantity: l.quantity,
        position: l.position ?? i,
        quoted_unit_amount: l.live_unit_amount ?? null,
        quoted_subtotal: l.live_subtotal ?? null,
        quoted_unit_weight_grams: l.unit_weight_grams ?? null,
        quoted_weight_source: l.weight_source ?? null,
        note: l.note ?? null,
        // #1439 S7 — HOW the price above was reached. Null on a line quoted at
        // its catalog price, which is most of them. The three override fields
        // travel together: without the input amount and the rate, a converted
        // number cannot be reproduced once FX has moved.
        override_kind: l.override?.kind ?? null,
        override_input_amount: l.override?.input_amount ?? null,
        override_input_currency_code: l.override?.input_currency_code ?? null,
        override_fx_rate: l.override?.fx_rate ?? null,
      }))
    )

    // The raw token leaves here exactly once. It is never persisted, so a DB
    // read cannot reconstruct a working link.
    return new StepResponse({ quote, token: raw }, quote.id)
  },
  async (quoteId, { container }) => {
    if (!quoteId) return
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    await service.deletePartnerQuotes([quoteId]).catch(() => {})
  }
)

/**
 * Mint a B2B quote (#1389 S3).
 *
 * Order matters and every step reverses. The email is deliberately NOT sent
 * here: freeze before send, so a mail can never disagree with the row it
 * describes.
 */
export const mintQuoteWorkflow = createWorkflow(
  "mint-partner-quote",
  (input: MintQuoteInput) => {
    const timing = prepareTimingStep(input)

    // Before anything is created. A readiness failure must cost nothing —
    // no customer, no group, no price list, nothing to compensate.
    validateQuoteReadinessStep(input)

    const buyer = resolveQuoteBuyerStep(input)
    const catalogView = buildAndFreezeStep({ mint: input, now: timing.now } as any)

    /**
     * The trade price (#1439 S7). Returns the SAME view with the overridden
     * numbers folded in, so every consumer below — the price list, the frozen
     * row, the basket totals — reads one number and no second pricing path
     * exists. A basket with no overrides passes straight through, untouched
     * and without a store read or an FX call.
     */
    const view = applyLineOverridesStep({
      mint: input,
      view: catalogView,
    } as any)

    /**
     * 🔴 The amount to freeze is the LIVE one.
     *
     * `buildQuoteView` is called with `quote: null` at mint time — there is no
     * persisted quote yet — so `quoted_unit_amount` is null on EVERY line by
     * construction (`build-quote-view.ts`: it reads the frozen row, which does
     * not exist). Handing `view.lines` straight to `planQuotePrices`, which
     * correctly drops any line with a null amount, dropped every line and made
     * the mint fail 100% of the time with "No quoted line carried a price".
     *
     * `persistQuoteStep` already reads `live_unit_amount` for exactly this
     * reason; this is the same conversion, at the sibling call site that
     * missed it. The `quoted_*` fields are for comparing a LATER view against
     * a quote already on disk — at mint, live IS the quote.
     */
    const priceRows = transform({ view }, ({ view }) =>
      ((view as any)?.lines ?? []).map((l: any) => ({
        variant_id: l.variant_id,
        quantity: l.quantity,
        quoted_unit_amount: l.live_unit_amount ?? null,
      }))
    )

    const priceList = mintPriceListStep({
      partner_id: input.partner_id,
      customer_group_id: buyer.customer_group_id,
      currency_code: input.currency_code,
      expires_at: timing.expires_at,
      now: timing.now,
      lines: priceRows,
    } as any)

    /**
     * #1435 — retire the buyer's previous quotes AFTER the new price list is
     * minted and verified, so a failed mint never disturbs a quote the buyer
     * already holds. Its compensation restores them.
     */
    supersedePriorQuotesStep({
      customer_group_id: buyer.customer_group_id,
      now: timing.now,
    } as any)

    const persisted = persistQuoteStep({
      mint: input,
      view,
      buyer,
      price_list_id: priceList.price_list_id,
      expires_at: timing.expires_at,
      now: timing.now,
    } as any)

    return new WorkflowResponse(persisted)
  }
)

export default mintQuoteWorkflow
