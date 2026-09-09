import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { EditDesignItemsForm } from "../../../../components/forms/design-order-items/edit-design-items-form"

/**
 * `/app/design-orders/:lineItemId/edits` — change or detach the design behind
 * each ordered line, in a focus modal over the design order (#1918).
 *
 * Nested under the design-order page the same way
 * `routes/orders/[id]/carrier-shipment` sits under the core order and
 * `routes/products/[id]/link-design` under the product, so the order stays
 * behind the modal while the designs are re-pointed.
 *
 * 🔴 This does NOT edit the ORDER. It moves which design each line stands for;
 * the line's title, price, quantity and the order totals are untouched and no
 * order edit is created. Repricing a captured order is a separate, deliberate
 * step through Medusa's own order-edit flow, taken once the designs are
 * finished — not a side effect of re-pointing a design.
 */
export default function DesignOrderEditsPage() {
  const { id } = useParams()

  if (!id) {
    return null
  }

  return (
    <RouteFocusModal>
      <EditDesignItemsForm pageLineItemId={id} />
    </RouteFocusModal>
  )
}
