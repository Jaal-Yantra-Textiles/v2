import {  useParams } from "react-router-dom";
import { useInventoryOrder, useUpdateInventoryOrder } from "../../../../../../hooks/api/inventory-orders";
import { MetadataForm } from "../../../../../../components/common/medata-form";



const InventoryOrdersMetadata = () => {
  const { id } = useParams();
  

  const { inventoryOrder, isPending, isError, error } = useInventoryOrder(id!);

  const { mutateAsync, isPending: isMutating } = useUpdateInventoryOrder(inventoryOrder?.id!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={inventoryOrder?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default InventoryOrdersMetadata;


