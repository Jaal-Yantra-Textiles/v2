import { Button, Container, Heading } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerInventoryOrder } from "../../hooks/api/partner-inventory-orders"

type InventoryOrderActionsSectionProps = {
  inventoryOrder: PartnerInventoryOrder
  isPending?: boolean
  /**
   * Path prefix for the action sub-routes. Empty on the bespoke
   * `/inventory-orders/:id` page (links resolve to `start` etc.); on the
   * unified order detail (`/orders/:id`) the actions live under `inventory/`
   * to avoid colliding with retail order sub-routes (#342).
   */
  linkPrefix?: string
}

/**
 * Start / Complete / Submit-Payment actions for an inventory work-order,
 * gated on the partner lifecycle status. Shared between the bespoke inventory
 * detail and the unified order detail.
 */
export const InventoryOrderActionsSection = ({
  inventoryOrder,
  isPending = false,
  linkPrefix = "",
}: InventoryOrderActionsSectionProps) => {
  const partnerStatus = inventoryOrder?.partner_info?.partner_status

  const canStart = partnerStatus === "assigned" || partnerStatus === "incoming"
  const canComplete = partnerStatus === "in_progress" || partnerStatus === "finished"

  const showStart = canStart && !inventoryOrder?.partner_info?.partner_started_at
  const showComplete =
    canComplete && !inventoryOrder?.partner_info?.partner_completed_at
  const showSubmitPayment = !!inventoryOrder?.partner_info?.partner_started_at

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {/* Pass the legacy inventory_order id via router state so the action
            modals (mounted under the unified order route) resolve their target
            without an extra fetch. */}
        {showStart && (
          <Button size="small" variant="secondary" disabled={isPending} asChild>
            <Link to={`${linkPrefix}start`} state={{ inventoryOrderId: inventoryOrder.id }}>
              Start
            </Link>
          </Button>
        )}
        {showComplete && (
          <Button size="small" variant="primary" disabled={isPending} asChild>
            <Link to={`${linkPrefix}complete`} state={{ inventoryOrderId: inventoryOrder.id }}>
              Complete
            </Link>
          </Button>
        )}
        {showSubmitPayment && (
          <Button size="small" variant="secondary" disabled={isPending} asChild>
            <Link to={`${linkPrefix}submit-payment`} state={{ inventoryOrderId: inventoryOrder.id }}>
              Submit Payment
            </Link>
          </Button>
        )}
      </div>
    </Container>
  )
}
