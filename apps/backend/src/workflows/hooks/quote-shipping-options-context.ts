import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
} from "@medusajs/medusa/core-flows"

import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"

/**
 * Keep an accepted quote's freight option visible to that quote's cart, and to
 * nothing else (#1439 S11).
 *
 * ## Why the option exists at all
 *
 * An accepted quote has to charge the freight it froze at mint. Core will not
 * take an amount from a caller: `refreshCartShippingMethodsWorkflow` rewrites
 * every shipping method's amount from its option's `calculated_price` on the
 * next cart update, and **deletes** the method outright if the option no longer
 * prices for the cart. So the frozen number has to BE an option's price, which
 * is why acceptance mints a flat option priced at `quoted_freight`.
 *
 * ## Why it needs hiding
 *
 * That option lives in a real service zone, so with no rule it would be offered
 * to every other cart shipping to the same zone — one buyer's negotiated
 * freight handed to the next. Same shape as #1433, where a missing filter
 * offered a Mumbai buyer another partner's pickup option.
 *
 * The option therefore carries a rule `quote_id eq <quote id>`, and this hook
 * is what puts `quote_id` into the matching context.
 *
 * 🔑 **A missing context key excludes the option; it does not ignore the rule.**
 * `isContextValid` stringifies the absent value to `"undefined"` and compares,
 * so an ordinary cart fails the rule and never sees the option. Hiding is the
 * default state; this hook only opens it for the cart that earned it.
 *
 * ## 🔴 Why this reads the database instead of `cart.metadata`
 *
 * The obvious implementation — stamp `quote_id` on the cart's metadata and read
 * it back here — is wrong, and wrong in the direction that looks like it works.
 * Neither list workflow fetches `metadata`:
 *
 * - the pricing variant queries `cartFieldsForCalculateShippingOptionsPrices`
 * - the plain variant queries `fieldsForPricingContext`
 *
 * Neither array contains `metadata`, so `cart.metadata` is `undefined` on both
 * paths and every cart — quote carts included — would resolve to "none". The
 * freight option would then be invisible to the one cart it was minted for, the
 * shipping method would be dropped on the first refresh, and the accepted cart
 * would silently lose its freight line somewhere between acceptance and
 * payment. That is a wrong number arriving quietly, which is the failure mode
 * this whole epic keeps rediscovering.
 *
 * So the lookup is by `accepted_cart_id`, which is indexed for exactly this.
 * One indexed read per shipping-option listing; a non-quote cart matches
 * nothing and costs an empty index probe.
 *
 * ⚠️ Registered on BOTH list workflows, as core's own docs instruct. The
 * pricing variant backs `addShippingMethodToCart` and every cart refresh; the
 * plain variant backs the storefront's option list. Wiring only one produces a
 * cart that can be given the option and is then told the option is invalid.
 */
const setQuoteShippingContext = async (
  { cart }: { cart: any },
  { container }: { container: any }
) => {
  const cartId = cart?.id
  if (!cartId) {
    return { quote_id: "none" }
  }

  try {
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)
    const rows = await service.listPartnerQuotes(
      { accepted_cart_id: cartId } as any,
      { take: 1 }
    )
    const quoteId = rows?.[0]?.id
    // The literal "none" matters: the rule compares `${contextValue}` against
    // its value, so this is simply a string no quote id can equal.
    return { quote_id: quoteId ? String(quoteId) : "none" }
  } catch {
    // Shipping options must not 500 because a lookup failed. Falling back to
    // "none" hides the quote option, which fails toward showing the buyer
    // fewer options rather than toward offering someone else's freight.
    return { quote_id: "none" }
  }
}

listShippingOptionsForCartWithPricingWorkflow.hooks.setShippingOptionsContext(
  setQuoteShippingContext as any
)

listShippingOptionsForCartWorkflow.hooks.setShippingOptionsContext(
  setQuoteShippingContext as any
)
