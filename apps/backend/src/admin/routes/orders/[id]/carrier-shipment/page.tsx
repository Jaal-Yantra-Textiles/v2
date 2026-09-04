import { useParams } from "react-router-dom"
import { Heading } from "@medusajs/ui"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { CarrierShipmentForm } from "../../../../components/forms/order-carrier-shipment/carrier-shipment-form"

/**
 * `/app/orders/:id/carrier-shipment` — booking a shipment, in a drawer over the
 * order it belongs to.
 *
 * Nesting an extension route under the CORE order page works the same way
 * `routes/products/[id]/link-people` does; the order detail stays behind the
 * drawer, so an operator keeps the addresses and line items in view while
 * filling the form in.
 */
export default function CarrierShipmentDrawerPage() {
  const { id } = useParams()

  if (!id) {
    return null
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Book a carrier shipment</Heading>
      </RouteDrawer.Header>
      {/* `RouteDrawer.Body` already scrolls; a hand-rolled wrapper here would
          give the long form a second scroll container inside the first. */}
      <RouteDrawer.Body>
        <CarrierShipmentForm orderId={id} />
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}
