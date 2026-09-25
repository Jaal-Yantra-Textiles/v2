import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Container, Text } from "@medusajs/ui"
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { workOrderHref } from "../lib/work-order-href"

/**
 * #2264 — a WORK order never stays on the core order screen.
 *
 * `/orders/:id` is a sale screen (payment, fulfilment, customer, refunds); a
 * work order is a purchase from a partner and has its own page. Links that
 * know they hold a work order go there directly (`orderHref`); this catches
 * every other way in — a payout line, a bookmark, a pasted id — and replaces
 * the history entry, so Back does not bounce the admin into it again.
 *
 * A customer sale renders nothing and stays.
 */
const OrderWorkOrderRedirect = ({ data: order }: DetailWidgetProps<any>) => {
  const navigate = useNavigate()
  const target = workOrderHref(order)

  useEffect(() => {
    if (target) navigate(target, { replace: true })
  }, [target, navigate])

  if (!target) return null

  return (
    <Container className="px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
        This is a work order, not a sale — opening its page…
      </Text>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.before",
})

export default OrderWorkOrderRedirect
