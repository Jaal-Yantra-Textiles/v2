import { Button, Container, Heading } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerInventoryOrder } from "../../../../hooks/api/partner-inventory-orders"

type InventoryOrderActionsSectionProps = {
  inventoryOrder: PartnerInventoryOrder
  isPending?: boolean
}

export const InventoryOrderActionsSection = ({
  inventoryOrder,
  isPending = false,
}: InventoryOrderActionsSectionProps) => {
  const partnerStatus = inventoryOrder?.partner_info?.partner_status

  const canStart = partnerStatus === "assigned" || partnerStatus === "incoming"
  const canComplete = partnerStatus === "in_progress" || partnerStatus === "finished"

  const showStart = canStart && !inventoryOrder?.partner_info?.partner_started_at
  const showComplete =
    canComplete && !inventoryOrder?.partner_info?.partner_completed_at

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {showStart && (
          <Button size="small" variant="secondary" disabled={isPending} asChild>
            <Link to="start">Start</Link>
          </Button>
        )}
        {showComplete && (
          <Button size="small" variant="primary" disabled={isPending} asChild>
            <Link to="complete">Complete</Link>
          </Button>
        )}
      </div>
    </Container>
  )
}
