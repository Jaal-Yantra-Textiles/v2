import { isStripeLike, paymentInfoMap } from "@lib/constants"

/**
 * What the shopper is actually asked to choose between at checkout.
 *
 * The raw list is the region's payment PROVIDERS, which is an implementation
 * detail with a processor's brand on it. Two things went wrong when it was
 * rendered directly:
 *
 * 🔴 A region with one provider still drew a chooser — a single tile reading
 * "Stripe", above a card field. There is no choice to make there, and naming
 * the processor tells the shopper nothing about how they are going to pay.
 *
 * 🔴 Europe carries BOTH `pp_stripe_stripe` and
 * `pp_stripe-connect_stripe-connect`, so it drew two tiles, both titled
 * "Stripe". The split between platform and merchant-direct settlement is
 * deliberate and #985 says the buyer never sees it — but the UI showed it
 * twice and gave the two halves the same name.
 *
 * So Stripe-like providers fold into ONE buyer-facing entry. Card, wallets and
 * whatever else Stripe offers for the currency are then chosen inside the
 * Payment Element, which is where a shopper can actually see them.
 */

export type BuyerPaymentMethod = {
  /** The provider id the session is initiated with. */
  id: string
  title: string
}

/** The generic Stripe entries, which differ only in how we settle. */
const isGenericStripe = (id: string) =>
  isStripeLike(id) &&
  id !== "pp_stripe-ideal_stripe" &&
  id !== "pp_stripe-bancontact_stripe"

/**
 * Fold the region's providers into the choices worth showing.
 *
 * ⚠️ `activeProviderId` — the provider of a session the cart already has —
 * wins the fold. Otherwise a shopper who has already started paying through
 * one Stripe provider could be silently moved onto the other by a re-render,
 * and that decides where the money settles.
 */
export const foldPaymentMethods = (
  methods: { id: string }[],
  activeProviderId?: string
): BuyerPaymentMethod[] => {
  const out: BuyerPaymentMethod[] = []
  let stripeSlot = -1

  for (const method of methods) {
    const title = paymentInfoMap[method.id]?.title ?? method.id

    if (!isGenericStripe(method.id)) {
      out.push({ id: method.id, title })
      continue
    }

    if (stripeSlot === -1) {
      stripeSlot = out.length
      out.push({ id: method.id, title })
      continue
    }

    // A second generic Stripe provider: keep the one the cart is already
    // paying through, otherwise leave the first in place.
    if (method.id === activeProviderId) {
      out[stripeSlot] = { id: method.id, title }
    }
  }

  return out
}

/**
 * A chooser is worth drawing only when there is something to choose. With one
 * method the tile is pure decoration — and, being a processor's name, worse
 * than decoration.
 */
export const shouldShowMethodChooser = (
  folded: BuyerPaymentMethod[]
): boolean => folded.length > 1
