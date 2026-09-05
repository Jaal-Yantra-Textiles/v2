/**
 * POST /admin/designs/draft-order/preview
 *
 * The customer-less twin of the design-order preview. It re-exports that
 * handler verbatim: the estimate depends on the DESIGNS and the currency, never
 * on who is buying — the customer route's own handler already ignores its
 * `:id`. Two paths, one estimator.
 */
export { POST } from "../../../customers/[id]/design-order/preview/route"
