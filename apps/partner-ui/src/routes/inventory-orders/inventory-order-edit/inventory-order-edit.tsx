import { RouteFocusModal } from "../../../components/modals"
import { Skeleton } from "../../../components/common/skeleton"
import { useOrder } from "../../../hooks/api/orders"
import { usePartnerInventoryOrder } from "../../../hooks/api/partner-inventory-orders"
import { useInventoryActionTarget } from "../../../hooks/use-inventory-action-target"
import { InventoryOrderEditForm } from "./components/inventory-order-edit-form"

/**
 * #1752 — the partner proposes line edits + a tax charge on an assigned
 * inventory order. A full-page focus modal (not a drawer): the DataGrid wants
 * the width. Nothing is applied — the proposal waits for an admin approval.
 */
export const InventoryOrderEdit = () => {
  return (
    <RouteFocusModal>
      <RouteFocusModal.Title asChild>
        <span className="sr-only">Edit order lines</span>
      </RouteFocusModal.Title>
      <RouteFocusModal.Description asChild>
        <span className="sr-only">
          Propose changes to the order lines and tax
        </span>
      </RouteFocusModal.Description>
      <InventoryOrderEditContent />
    </RouteFocusModal>
  )
}

const InventoryOrderEditContent = () => {
  const { inventoryOrderId: id, unifiedOrderId } = useInventoryActionTarget()
  const { inventoryOrder, isLoading } = usePartnerInventoryOrder(id || "")
  const { order } = useOrder(
    unifiedOrderId || "",
    { fields: "currency_code" },
    { enabled: !!unifiedOrderId }
  )

  const currencyCode = (order as any)?.currency_code || "inr"

  if (isLoading || !inventoryOrder) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <InventoryOrderEditForm
      inventoryOrder={inventoryOrder}
      currencyCode={currencyCode}
    />
  )
}