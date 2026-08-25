import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * The per-quote freight option: how it is named, and how it is torn down
 * (#1527).
 *
 * ## What this option is
 *
 * Accepting a quote cannot hand core an amount — `refreshCartShippingMethodsWorkflow`
 * rewrites every shipping method's amount from its option on each cart
 * refresh, and deletes the method outright when the option no longer prices.
 * So the frozen freight has to BE a shipping option's price, and acceptance
 * mints one: flat, priced at `quoted_freight`, in the donor option's zone,
 * carrying a rule `quote_id eq <id>` so core's rule engine shows it to that
 * quote's cart and to no other.
 *
 * ## Why it needs a teardown
 *
 * The rule hides it from other CARTS. It never hid it from the freight
 * ESTIMATE, which reads a location's options straight out of `query.graph` and
 * evaluates no rules — so every option ever minted stood as a candidate for
 * unrelated quotes. Three were live on prod on 25 Aug, all belonging to
 * revoked quotes, and two of them surfaced on a real customer's quote:
 *
 * ```
 * Quoted freight — 01M0Q7T078TQ36D3PQV1AGG472    35 eur
 * Quoted freight — 01M0QF8CN2S0TPA0HTKD0YHGJ7    99 inr   ← wins any INR quote
 * Quoted freight — 01M0QGQ4SW665XZH1QMTSFWX7Z    48.5 eur
 * ```
 *
 * The picker sorts on the raw amount, so ₹99 beats every real rate on every
 * INR lane regardless of weight or destination. Fourth instance of one shape:
 * a row nobody chose for *this* shipment winning it by being small (#1424,
 * #1430, #1485).
 *
 * ## 🔑 This is the SECOND line of defence, not the first
 *
 * `isQuotableShippingOption` now refuses any option carrying a `quote_id` rule
 * outright, which is what actually closes the hole — teardown alone would
 * leave a *live* quote's negotiated freight standing as a candidate for the
 * next buyer, and would rely on every future path that kills a quote
 * remembering to call this. This exists so dead rows do not accumulate in a
 * partner's option list forever, not to make the picker safe.
 *
 * ## 🔴 What must survive
 *
 * The store's own configured flat option — the one the quote was RATED against
 * and froze in `quoted_shipping_option_id` — is not ours to delete. It is
 * shared by every quote on that lane. Deleting it would take the lane down for
 * all of them, which is a far worse failure than the leak being fixed. Hence
 * the identity is checked three ways before anything is removed: the name we
 * ourselves constructed, the `quote_id` rule naming THIS quote, and an
 * explicit refusal to touch the donor id.
 */

/** The type code acceptance stamps on the option it mints. */
export const QUOTE_FREIGHT_OPTION_TYPE_CODE = "quoted-freight"

/** The option-level rule attribute that scopes it to one quote's cart. */
export const QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE = "quote_id"

/**
 * The option's name, constructed in exactly one place.
 *
 * 🔑 It is an identifier, not a label. The teardown finds the option by this
 * exact string, so the minting step and the teardown must never be able to
 * disagree about it — which they could, silently and forever, if each built
 * its own template. The leak is invisible either way: nothing fails when a
 * teardown matches nothing.
 */
export const quoteFreightOptionName = (quoteId: string): string =>
  `Quoted freight — ${quoteId}`

/**
 * Delete the freight option(s) this quote minted for itself. Idempotent.
 *
 * Returns the ids removed, so the caller can record what it actually did
 * rather than claiming a clean teardown it never performed — the same reason
 * `revokeQuote` logs when a quote had no price list to delete.
 *
 * Never throws. A quote being revoked has already had its price list deleted
 * and its status written; failing the whole revoke because a cleanup could not
 * complete would leave the caller retrying a destructive operation that
 * already ran (the #1517 defect). The option being left behind is now harmless
 * — see the header — so a warning is the correct severity.
 */
export const deleteQuoteFreightOptions = async (
  scope: any,
  quote: { id: string; quoted_shipping_option_id?: string | null }
): Promise<{ deleted_shipping_option_ids: string[] }> => {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { data: options = [] } = await query.graph({
      entity: "shipping_options",
      fields: ["id", "name", "rules.*"],
      // 🔴 An EXACT name, never a bare list. `filters: { name: undefined }` is
      // NO filter, and an unfiltered read here would hand the delete below
      // every shipping option on the platform (#1397/#1433).
      filters: { name: quoteFreightOptionName(quote.id) },
    })

    const ids = (options ?? [])
      .filter((o: any) => {
        // The donor option is the store's own and is shared by every quote on
        // the lane. A name collision alone must never be able to remove it.
        if (o?.id && o.id === quote.quoted_shipping_option_id) return false

        // And it must actually claim to belong to THIS quote. A store that
        // hand-named an option the same thing is not ours to delete.
        return (o?.rules ?? []).some(
          (r: any) =>
            String(r?.attribute || "").trim() ===
              QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE &&
            String(r?.value ?? "").trim() === String(quote.id)
        )
      })
      .map((o: any) => o.id)

    if (!ids.length) {
      return { deleted_shipping_option_ids: [] }
    }

    await deleteShippingOptionsWorkflow(scope).run({ input: { ids } })
    logger?.info?.(
      `[quote] teardown ${quote.id} deleted freight option(s) ${ids.join(", ")}`
    )
    return { deleted_shipping_option_ids: ids }
  } catch (e: any) {
    logger?.warn?.(
      `[quote] teardown ${quote.id} could not delete its freight option: ${e?.message ?? String(e)}`
    )
    return { deleted_shipping_option_ids: [] }
  }
}
