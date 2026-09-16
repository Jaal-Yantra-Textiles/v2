import { RouteFocusModal } from "../../../components/modal/route-focus-modal"
import { StartDesignOrderWizard } from "../../../components/designs/start-design-order-wizard"

/**
 * /app/design-orders/new — start a design order.
 *
 * A route rather than local `open` state, so the flow is linkable, survives a
 * refresh, and closes by navigating back — the same shape as the buyer and
 * reprice drawers on the detail page.
 */
export default function StartDesignOrderPage() {
  return (
    <RouteFocusModal>
      <StartDesignOrderWizard />
    </RouteFocusModal>
  )
}
