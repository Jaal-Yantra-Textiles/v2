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
import { buildQuoteView } from "../../modules/partner-quote/lib/build-quote-view"
import {
  generateQuoteToken,
  quoteExpiryFrom,
  DEFAULT_QUOTE_TTL_DAYS,
} from "../../modules/partner-quote/lib/token"
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
  partner_note?: string | null
  lines: Array<{
    variant_id: string
    quantity: number
    position?: number
    note?: string | null
  }>
  destination_country_code: string
  destination_postal_code?: string | null
  destination_city?: string | null
  currency_code: string
  region_id?: string | null
  carrier?: string
  ttl_days?: number
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
      now: payload.now,
    })

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
      email_sent_to: input.mint.buyer_email,
      partner_note: input.mint.partner_note ?? null,
      quoted_subtotal: input.view.live?.subtotal ?? null,
      quoted_freight: input.view.live?.freight ?? null,
      quoted_landed_total: input.view.live?.landed_total ?? null,
      quoted_weight_grams: input.view.total_weight_grams ?? null,
      quoted_at: new Date(input.now),
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
        quantity: l.quantity,
        position: l.position ?? i,
        quoted_unit_amount: l.live_unit_amount ?? null,
        quoted_subtotal: l.live_subtotal ?? null,
        quoted_unit_weight_grams: l.unit_weight_grams ?? null,
        quoted_weight_source: l.weight_source ?? null,
        note: l.note ?? null,
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

    const buyer = resolveQuoteBuyerStep(input)
    const view = buildAndFreezeStep({ mint: input, now: timing.now } as any)

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
