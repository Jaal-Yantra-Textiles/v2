import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { TruckFast } from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

/**
 * Booking a carrier shipment — now a door, not the room.
 *
 * The form itself (rates, dimensions, pickup slot, label, manual AWB) lives in
 * `components/forms/order-carrier-shipment` and is rendered by the RouteDrawer
 * at `/app/orders/:id/carrier-shipment`. As a flat section on the order page it
 * pushed everything below it off the fold whether or not anyone was shipping
 * that day; in a drawer the order detail stays readable and the form keeps its
 * own URL, so a half-filled booking survives a refresh and can be linked to.
 *
 * ⚠️ Deliberately dumb. It fetches nothing: the drawer owns all the state, and
 * a widget that duplicated part of it would be a second opinion about what has
 * already been booked. The read-only tracking widget below
 * (`order.details.after`) is what shows the result.
 */
type AdminOrder = { id: string }

const OrderCarrierShipmentWidget = ({
  data: order,
}: DetailWidgetProps<AdminOrder>) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Carrier shipment</Heading>
        <Link to={`/orders/${order.id}/carrier-shipment`}>
          <Button size="small" variant="secondary">
            <TruckFast />
            Book a shipment
          </Button>
        </Link>
      </div>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Compare live carrier rates, book a pickup and generate a label — or
          attach an AWB you booked elsewhere.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  // Directly above the read-only tracking widget (`order.details.after`), so the
  // action and its result still read as one section.
  zone: "order.details.after",
})

export default OrderCarrierShipmentWidget
