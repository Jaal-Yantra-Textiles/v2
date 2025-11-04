import { useParams } from "react-router-dom";
import { useInventoryOrder } from "../../../../../hooks/api/inventory-orders";
import { EditOrderLines } from "../../../../../components/inventory-orders/edit-order-lines";
import { TwoColumnPageSkeleton } from "../../../../../components/table/skeleton";
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal";

const EditOrderLinesPage = () => {
  const { id } = useParams();
  const { inventoryOrder, isLoading } = useInventoryOrder(id!, {
    fields: ['orderlines.*', 'orderlines.inventory_items.*']
  });

  if (isLoading || !inventoryOrder) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={1} />;
  }

  return (
    <RouteFocusModal>
      <EditOrderLines inventoryOrder={inventoryOrder} />
    </RouteFocusModal>
  );
};

export default EditOrderLinesPage;
