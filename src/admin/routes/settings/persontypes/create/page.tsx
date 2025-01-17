import { CreatePersonTypeComponent } from "../../../../components/creates/create-person-type";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

const CreatePersonTypeModal = () => {
  return (
    <RouteFocusModal>
      <CreatePersonTypeComponent />
    </RouteFocusModal>
  );
};

export default CreatePersonTypeModal;
