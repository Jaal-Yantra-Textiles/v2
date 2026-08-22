import { RouteFocusModal } from "../../../components/modal/route-focus-modal"

import { MintQuoteForm } from "./mint-quote-form"

/**
 * Minting lives in a focus modal, like every other create route on this admin.
 *
 * It shipped as a plain `Container` on the page, which made it the one create
 * flow that navigated AWAY from wherever the operator was — and the quote list
 * is exactly the context you want back the moment a mint finishes.
 *
 * 🔑 The hook lives in the CHILD. `useRouteModal` reads a context that
 * `RouteFocusModal` itself provides, so a component that renders the modal
 * cannot also call the hook — that is #1352, and it throws at render.
 */
const MintQuotePage = () => (
  <RouteFocusModal prev="/quotes">
    <MintQuoteForm />
  </RouteFocusModal>
)

export const handle = {
  breadcrumb: () => "Mint",
}

export default MintQuotePage
