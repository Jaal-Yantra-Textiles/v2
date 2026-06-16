import { CreateInventoryOrderComponent } from "../../../../components/creates/create-inventory-order";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

const CreateInventoryOrderModal = () => {
  return (
    <RouteFocusModal>
      <CreateInventoryOrderComponent />
    </RouteFocusModal>
  );
};

export default CreateInventoryOrderModal;
