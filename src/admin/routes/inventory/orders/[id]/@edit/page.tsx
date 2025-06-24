import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useInventoryOrder } from "../../../../../hooks/api/inventory-orders";
import { RoundSpinner } from "../../../../../components/ui/spinner";
import { EditInventoryOrderForm } from "../../../../../components/edits/edit-inventory-order";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";

export default function EditInventoryOrderPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { inventoryOrder, isLoading } = useInventoryOrder(id!);

  const ready = !!inventoryOrder;

  if (isLoading || !inventoryOrder) {
    return <RoundSpinner/>
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("Edit Inventory Order")}</Heading>
      </RouteDrawer.Header>
        {ready && <EditInventoryOrderForm order={inventoryOrder}/>}
    </RouteDrawer>
  );
}
