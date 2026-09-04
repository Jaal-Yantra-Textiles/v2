import { MintQuoteForm } from "./mint-quote-form"

/**
 * Minting is a PAGE, not a focus modal.
 *
 * It shipped as a four-step wizard inside `RouteFocusModal` — the shape every
 * other create route on this admin uses. That works for a form with a handful
 * of fields; a quote is not that. The steps had grown to 2,420 lines, and a
 * modal showed exactly one of the four questions at a time: the operator could
 * not see the basket while typing a destination, nor re-read the buyer while
 * setting quantities, and the readiness verdict appeared above a grid and
 * scrolled away.
 *
 * As a page it is the same four questions as sections, laid out the way the
 * quote DETAIL route is laid out — the create route now looks like the record
 * it produces, which it never did before.
 */
const MintQuotePage = () => (
  <div className="flex w-full flex-col gap-y-3 p-3">
    <MintQuoteForm />
  </div>
)

export const handle = {
  breadcrumb: () => "Mint",
}

export default MintQuotePage
