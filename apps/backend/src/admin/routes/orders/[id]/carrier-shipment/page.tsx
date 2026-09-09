import { useParams } from "react-router-dom"
import { Heading } from "@medusajs/ui"

import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { CarrierShipmentForm } from "../../../../components/forms/order-carrier-shipment/carrier-shipment-form"

/**
 * `/app/orders/:id/carrier-shipment` — booking a shipment, in a focus modal over
 * the order it belongs to.
 *
 * Nesting an extension route under the CORE order page works the same way
 * `routes/products/[id]/link-people` does.
 *
 * A FOCUS modal rather than a drawer: booking a shipment is a rate comparison
 * followed by a decision, and the rate table needs the width. The drawer forced
 * a long form and a multi-column table into a narrow rail.
 */
export default function CarrierShipmentModalPage() {
  const { id } = useParams()

  if (!id) {
    return null
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <Heading>Book a carrier shipment</Heading>
      </RouteFocusModal.Header>
      {/* `RouteFocusModal.Body` already scrolls; a hand-rolled wrapper here
          would give the long form a second scroll container inside the first. */}
      <RouteFocusModal.Body>
        <CarrierShipmentForm orderId={id} />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}
