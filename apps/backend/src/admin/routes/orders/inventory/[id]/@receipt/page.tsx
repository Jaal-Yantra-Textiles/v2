import { useParams } from "react-router-dom";
import { useInventoryOrder } from "../../../../../hooks/api/inventory-orders";
import { INVENTORY_ORDER_DETAIL_FIELDS } from "../constants";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";
import { InventoryOrderReceiptForm } from "../../../../../components/inventory-orders/inventory-order-receipt-form";
import { RoundSpinner } from "../../../../../components/ui/spinner";

export default function InventoryOrderReceiptPage() {
  const { id } = useParams();
  const { inventoryOrder, isLoading } = useInventoryOrder(id!, {
    fields: INVENTORY_ORDER_DETAIL_FIELDS.split(",").map((f) => f.trim()),
  });

  return (
    <RouteFocusModal>
      {isLoading || !inventoryOrder ? (
        <RouteFocusModal.Body className="flex items-center justify-center">
          <RoundSpinner />
        </RouteFocusModal.Body>
      ) : (
        <InventoryOrderReceiptForm inventoryOrder={inventoryOrder} />
      )}
    </RouteFocusModal>
  );
}